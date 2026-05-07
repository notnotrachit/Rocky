use std::{
    fs,
    path::PathBuf,
    sync::mpsc,
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::Instant,
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use transcribe_rs::{whisper_cpp::{WhisperEngine, WhisperInferenceParams}};

use crate::models::{CommandError, VoiceDownloadProgress, VoiceLevel, VoiceModelInfo};
use crate::settings;

struct VoiceModelDef {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    engine: &'static str,
    filename: &'static str,
    url: &'static str,
    size_mb: u32,
    recommended: bool,
}

struct RecordingSession {
    stop_tx: mpsc::Sender<()>,
    result_rx: mpsc::Receiver<Result<Vec<f32>, String>>,
    sample_rate: u32,
    started_at: Instant,
}

static RECORDING_SESSION: OnceLock<Mutex<Option<RecordingSession>>> = OnceLock::new();
static WHISPER_ENGINE: OnceLock<Mutex<Option<LoadedWhisperEngine>>> = OnceLock::new();

struct LoadedWhisperEngine {
    model_id: String,
    engine: WhisperEngine,
}

const MODELS: &[VoiceModelDef] = &[
    VoiceModelDef {
        id: "parakeet-tdt-0.6b-v3",
        name: "Parakeet V3",
        description: "Fast and accurate. Supports 25 European languages.",
        engine: "parakeet",
        filename: "parakeet-v3-int8.tar.gz",
        url: "https://blob.handy.computer/parakeet-v3-int8.tar.gz",
        size_mb: 456,
        recommended: true,
    },
    VoiceModelDef {
        id: "small",
        name: "Whisper Small",
        description: "Fast and fairly accurate.",
        engine: "whisper",
        filename: "ggml-small.bin",
        url: "https://blob.handy.computer/ggml-small.bin",
        size_mb: 465,
        recommended: false,
    },
    VoiceModelDef {
        id: "medium",
        name: "Whisper Medium",
        description: "Good accuracy, medium speed.",
        engine: "whisper",
        filename: "whisper-medium-q4_1.bin",
        url: "https://blob.handy.computer/whisper-medium-q4_1.bin",
        size_mb: 469,
        recommended: false,
    },
    VoiceModelDef {
        id: "large",
        name: "Whisper Large",
        description: "Good accuracy, but slow.",
        engine: "whisper",
        filename: "ggml-large-v3-q5_0.bin",
        url: "https://blob.handy.computer/ggml-large-v3-q5_0.bin",
        size_mb: 1031,
        recommended: false,
    },
    VoiceModelDef {
        id: "turbo",
        name: "Whisper Turbo",
        description: "Balanced accuracy and speed.",
        engine: "whisper",
        filename: "ggml-large-v3-turbo.bin",
        url: "https://blob.handy.computer/ggml-large-v3-turbo.bin",
        size_mb: 1549,
        recommended: false,
    },
];

pub fn models(app: &AppHandle) -> Result<Vec<VoiceModelInfo>, CommandError> {
    MODELS.iter().map(|model| model_info(app, model)).collect()
}

pub async fn download_model(app: AppHandle, model_id: String) -> Result<VoiceModelInfo, CommandError> {
    let model = MODELS
        .iter()
        .find(|model| model.id == model_id)
        .ok_or_else(|| CommandError::from(format!("Unknown voice model: {model_id}")))?;

    let path = model_path(&app, model)?;
    if path.exists() {
        return model_info(&app, model);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| CommandError::from(format!("Could not create voice model directory: {error}")))?;
    }

    let tmp_path = path.with_extension("download");
    let response = reqwest::get(model.url)
        .await
        .map_err(|error| CommandError::from(format!("Voice model download failed: {error}")))?;

    if !response.status().is_success() {
        return Err(CommandError::from(format!("Voice model download failed: HTTP {}", response.status())));
    }

    let total_bytes = response.content_length();
    emit_progress(&app, model.id, 0, total_bytes, false);

    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|error| CommandError::from(format!("Could not create voice model file: {error}")))?;
    let mut stream = response.bytes_stream();
    let mut downloaded_bytes = 0_u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| CommandError::from(format!("Voice model download interrupted: {error}")))?;
        downloaded_bytes += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|error| CommandError::from(format!("Could not write voice model file: {error}")))?;
        emit_progress(&app, model.id, downloaded_bytes, total_bytes, false);
    }

    file.flush()
        .await
        .map_err(|error| CommandError::from(format!("Could not flush voice model file: {error}")))?;
    tokio::fs::rename(&tmp_path, &path)
        .await
        .map_err(|error| CommandError::from(format!("Could not finish voice model download: {error}")))?;
    emit_progress(&app, model.id, downloaded_bytes, total_bytes, true);

    model_info(&app, model)
}

pub fn start_recording(app: AppHandle) -> Result<(), CommandError> {
    let mut slot = recording_slot()
        .lock()
        .map_err(|_| CommandError::from("Could not lock voice recorder state"))?;

    if slot.is_some() {
        return Err(CommandError::from("Rocky is already listening."));
    }

    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();
    let (result_tx, result_rx) = mpsc::channel::<Result<Vec<f32>, String>>();

    thread::spawn(move || {
        let result = run_recording_thread(app, stop_rx, ready_tx);
        let _ = result_tx.send(result);
    });

    let sample_rate = ready_rx
        .recv()
        .map_err(|_| CommandError::from("Microphone recorder exited before it was ready."))?
        .map_err(CommandError::from)?;

    *slot = Some(RecordingSession {
        stop_tx,
        result_rx,
        sample_rate,
        started_at: Instant::now(),
    });

    Ok(())
}

pub async fn stop_recording_and_transcribe(_app: AppHandle) -> Result<String, CommandError> {
    let session = {
        let mut slot = recording_slot()
            .lock()
            .map_err(|_| CommandError::from("Could not lock voice recorder state"))?;
        slot.take()
    }
    .ok_or_else(|| CommandError::from("Rocky was not listening."))?;

    let elapsed = session.started_at.elapsed();
    let _ = session.stop_tx.send(());
    let samples = session
        .result_rx
        .recv()
        .map_err(|_| CommandError::from("Microphone recorder stopped without returning audio."))?
        .map_err(CommandError::from)?;
    let sample_rate = session.sample_rate;
    let audio_seconds = samples.len() as f64 / sample_rate as f64;

    if samples.is_empty() || elapsed.as_millis() < 850 || audio_seconds < 0.75 {
        return Err(CommandError::from("Rocky heard no audio. Hold voice a little longer, question?"));
    }

    let stats = audio_stats(&samples);
    if !stats.has_voice {
        return Err(CommandError::from("Rocky heard silence. No words to decode, question?"));
    }

    transcribe_whisper(&_app, samples, sample_rate)
        .map(|text| text.trim().to_string())
        .and_then(|text| {
            if text.is_empty() || is_likely_silence_hallucination(&text) {
                Err(CommandError::from(format!("Rocky heard {audio_seconds:.1}s, but transcription returned empty text.")))
            } else {
                Ok(text)
            }
        })
}

struct AudioStats {
    has_voice: bool,
}

fn audio_stats(samples: &[f32]) -> AudioStats {
    if samples.is_empty() {
        return AudioStats { has_voice: false };
    }

    let rms = (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt();
    let peak = samples.iter().fold(0.0_f32, |max, sample| max.max(sample.abs()));
    let active_ratio = samples.iter().filter(|sample| sample.abs() > 0.012).count() as f32 / samples.len() as f32;

    AudioStats {
        has_voice: rms > 0.006 && peak > 0.035 && active_ratio > 0.015,
    }
}

fn is_likely_silence_hallucination(text: &str) -> bool {
    let normalized = text.trim().trim_matches(|character: char| character.is_ascii_punctuation()).to_lowercase();
    matches!(
        normalized.as_str(),
        "thank you"
            | "thanks"
            | "i'm rocky thank you"
            | "im rocky thank you"
            | "i am rocky thank you"
            | "you"
            | "bye"
            | "hello"
            | "okay"
            | "ok"
    )
}

fn model_info(app: &AppHandle, model: &VoiceModelDef) -> Result<VoiceModelInfo, CommandError> {
    let path = model_path(app, model)?;
    let is_downloaded = path.exists();

    Ok(VoiceModelInfo {
        id: model.id.to_string(),
        name: model.name.to_string(),
        description: model.description.to_string(),
        engine: model.engine.to_string(),
        filename: model.filename.to_string(),
        url: model.url.to_string(),
        size_mb: model.size_mb,
        is_recommended: model.recommended,
        is_downloaded,
        local_path: is_downloaded.then(|| path.to_string_lossy().to_string()),
    })
}

fn model_path(app: &AppHandle, model: &VoiceModelDef) -> Result<PathBuf, CommandError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| CommandError::from(format!("Could not resolve app data dir: {error}")))?;
    Ok(base.join("voice-models").join(model.filename))
}

fn emit_progress(app: &AppHandle, model_id: &str, downloaded_bytes: u64, total_bytes: Option<u64>, done: bool) {
    let percent = total_bytes.and_then(|total| {
        if total == 0 {
            None
        } else {
            Some(((downloaded_bytes as f64 / total as f64) * 100.0).clamp(0.0, 100.0))
        }
    });

    let _ = app.emit(
        "voice-download-progress",
        VoiceDownloadProgress {
            model_id: model_id.to_string(),
            downloaded_bytes,
            total_bytes,
            percent,
            done,
        },
    );
}

fn transcribe_whisper(app: &AppHandle, samples: Vec<f32>, sample_rate: u32) -> Result<String, CommandError> {
    let (model, path) = selected_whisper_model(app)?;
    let audio = resample_to_16khz(samples, sample_rate);
    let mut slot = WHISPER_ENGINE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| CommandError::from("Could not lock Whisper engine"))?;

    let needs_load = slot
        .as_ref()
        .map(|loaded| loaded.model_id != model.id)
        .unwrap_or(true);

    if needs_load {
        let engine = WhisperEngine::load(&path)
            .map_err(|error| CommandError::from(format!("Could not load Whisper model '{}': {error}", model.name)))?;
        *slot = Some(LoadedWhisperEngine {
            model_id: model.id.to_string(),
            engine,
        });
    }

    let loaded = slot
        .as_mut()
        .ok_or_else(|| CommandError::from("Whisper engine did not load"))?;
    let params = WhisperInferenceParams {
        language: Some("en".to_string()),
        translate: false,
        initial_prompt: Some("Transcribe the human's short voice message to Rocky. Return only spoken words.".to_string()),
        ..Default::default()
    };
    let result = loaded
        .engine
        .transcribe_with(&audio, &params)
        .map_err(|error| CommandError::from(format!("Whisper transcription failed: {error}")))?;

    Ok(result.text)
}

fn selected_whisper_model(app: &AppHandle) -> Result<(&'static VoiceModelDef, PathBuf), CommandError> {
    let settings = settings::read_voice_settings(app).unwrap_or_default();
    let selected = MODELS.iter().find(|model| model.id == settings.selected_model);
    let candidate = selected
        .filter(|model| model.engine == "whisper")
        .or_else(|| {
            MODELS
                .iter()
                .filter(|model| model.engine == "whisper")
                .find(|model| model_path(app, model).map(|path| path.exists()).unwrap_or(false))
        })
        .ok_or_else(|| CommandError::from("Select or download a Whisper voice model first. Parakeet support comes after archive extraction."))?;

    let path = model_path(app, candidate)?;
    if !path.exists() {
        return Err(CommandError::from(format!(
            "Whisper model '{}' is not downloaded yet. Download it from the Voice tab first.",
            candidate.name
        )));
    }

    Ok((candidate, path))
}

fn resample_to_16khz(samples: Vec<f32>, sample_rate: u32) -> Vec<f32> {
    const TARGET_RATE: u32 = 16_000;

    if sample_rate == TARGET_RATE || samples.is_empty() {
        return samples;
    }

    let ratio = sample_rate as f64 / TARGET_RATE as f64;
    let output_len = (samples.len() as f64 / ratio).ceil() as usize;
    let mut output = Vec::with_capacity(output_len);

    for index in 0..output_len {
        let source_pos = index as f64 * ratio;
        let left = source_pos.floor() as usize;
        let right = (left + 1).min(samples.len() - 1);
        let fraction = (source_pos - left as f64) as f32;
        let sample = samples[left] * (1.0 - fraction) + samples[right] * fraction;
        output.push(sample.clamp(-1.0, 1.0));
    }

    output
}

fn recording_slot() -> &'static Mutex<Option<RecordingSession>> {
    RECORDING_SESSION.get_or_init(|| Mutex::new(None))
}

fn run_recording_thread(
    app: AppHandle,
    stop_rx: mpsc::Receiver<()>,
    ready_tx: mpsc::Sender<Result<u32, String>>,
) -> Result<Vec<f32>, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No microphone input device found.".to_string())?;
    let supported_config = device
        .default_input_config()
        .map_err(|error| format!("Could not read microphone config: {error}"))?;
    let sample_format = supported_config.sample_format();
    let config: cpal::StreamConfig = supported_config.into();
    let sample_rate = config.sample_rate.0;
    let channels = usize::from(config.channels.max(1));
    let samples = Arc::new(Mutex::new(Vec::<f32>::with_capacity(sample_rate as usize * 8)));
    let last_level_emit = Arc::new(Mutex::new(Instant::now()));

    let stream = match sample_format {
        cpal::SampleFormat::F32 => build_input_stream::<f32, _>(
            &device,
            &config,
            channels,
            Arc::clone(&samples),
            Arc::clone(&last_level_emit),
            app.clone(),
            |error| eprintln!("Rocky voice input stream error: {error}"),
            |sample| sample,
        ),
        cpal::SampleFormat::I16 => build_input_stream::<i16, _>(&device, &config, channels, Arc::clone(&samples), Arc::clone(&last_level_emit), app.clone(), |error| eprintln!("Rocky voice input stream error: {error}"), |sample| {
            sample as f32 / i16::MAX as f32
        }),
        cpal::SampleFormat::U16 => build_input_stream::<u16, _>(&device, &config, channels, Arc::clone(&samples), Arc::clone(&last_level_emit), app.clone(), |error| eprintln!("Rocky voice input stream error: {error}"), |sample| {
            (sample as f32 / u16::MAX as f32) * 2.0 - 1.0
        }),
        _ => Err(cpal::BuildStreamError::StreamConfigNotSupported),
    }
    .map_err(|error| format!("Could not start microphone stream: {error}"))?;

    stream
        .play()
        .map_err(|error| format!("Could not activate microphone stream: {error}"))?;

    let _ = ready_tx.send(Ok(sample_rate));
    let _ = stop_rx.recv();
    drop(stream);

    samples
        .lock()
        .map(|buffer| buffer.clone())
        .map_err(|_| "Could not read captured voice samples".to_string())
}

fn build_input_stream<T, F>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    samples: Arc<Mutex<Vec<f32>>>,
    last_level_emit: Arc<Mutex<Instant>>,
    app: AppHandle,
    error_callback: impl FnMut(cpal::StreamError) + Send + 'static,
    convert: F,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: cpal::SizedSample + Copy,
    F: Fn(T) -> f32 + Send + Sync + 'static,
{
    device.build_input_stream(
        config,
        move |input: &[T], _| {
            let Ok(mut buffer) = samples.lock() else {
                return;
            };

            let mut rms_sum = 0.0_f32;
            let mut rms_count = 0_usize;
            for frame in input.chunks(channels) {
                let sum = frame.iter().copied().map(&convert).sum::<f32>();
                let sample = (sum / frame.len().max(1) as f32).clamp(-1.0, 1.0);
                rms_sum += sample * sample;
                rms_count += 1;
                buffer.push(sample);
            }

            if rms_count > 0 {
                let Ok(mut last_emit) = last_level_emit.lock() else {
                    return;
                };
                if last_emit.elapsed().as_millis() >= 50 {
                    *last_emit = Instant::now();
                    let rms = (rms_sum / rms_count as f32).sqrt();
                    let level = (rms * 5.0).clamp(0.0, 1.0);
                    let _ = app.emit("voice-level", VoiceLevel { level });
                }
            }
        },
        error_callback,
        None,
    )
}
