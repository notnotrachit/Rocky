import { FormEvent, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window";
import { ProviderPanel } from "../components/ProviderPanel";
import { ToggleRow } from "../components/ToggleRow";
import {
  emitClickThrough,
  emitPetAction,
  emitPetScale,
  downloadVoiceModel,
  getAccessibilityStatus,
  getControlSettings,
  getOllamaHealth,
  getOllamaModels,
  getPetScale,
  getVoiceModels,
  getVoiceSettings,
  observeAndPlan,
  planPetAction,
  requestAccessibilityPermission,
  setControlSettings,
  setPetScale as persistPetScale,
  setVoiceSettings,
  validateVoiceShortcut,
} from "../lib/commands";
import { defaultSettings, defaultVoiceSettings, idleAction, type AccessibilityObservation, type ActiveApp, type ControlSettings, type ControlTab, type OllamaModel, type PetAction, type PetAnimation, type RuntimeStatus, type VoiceDownloadProgress, type VoiceModelInfo, type VoiceSettings } from "../types";

const tabs: ControlTab[] = ["chat", "behavior", "voice", "privacy", "debug"];
const animations: PetAnimation[] = ["idle", "talk", "think", "inspect", "celebrate", "confused", "sleep", "wake"];

export function ControlsApp() {
  const [tab, setTab] = useState<ControlTab>("chat");
  const [action, setAction] = useState<PetAction>(idleAction);
  const [message, setMessage] = useState("");
  const [settings, setSettings] = useState<ControlSettings>(defaultSettings);
  const [voiceSettings, setVoiceSettingsState] = useState<VoiceSettings>(defaultVoiceSettings);
  const [voiceModels, setVoiceModels] = useState<VoiceModelInfo[]>([]);
  const [downloadingVoiceModel, setDownloadingVoiceModel] = useState<string | null>(null);
  const [voiceDownloadProgress, setVoiceDownloadProgress] = useState<Record<string, VoiceDownloadProgress>>({});
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaReady, setOllamaReady] = useState<boolean | null>(null);
  const [clickThrough, setClickThrough] = useState(false);
  const [petScale, setPetScale] = useState(1);
  const [activeApp, setActiveApp] = useState<ActiveApp | null>(null);
  const [accessibilityObservation, setAccessibilityObservation] = useState<AccessibilityObservation | null>(null);
  const [lastReactionKey, setLastReactionKey] = useState<string | null>(null);
  const [sanitizedObservationContext, setSanitizedObservationContext] = useState("");
  const [lastObservationSkip, setLastObservationSkip] = useState<string | null>(null);
  const [accessibilityGranted, setAccessibilityGranted] = useState<boolean | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>({ state: "idle", lastLatencyMs: null, lastError: null });
  const [shortcutDraft, setShortcutDraft] = useState(defaultVoiceSettings.pushToTalkShortcut);
  const [shortcutStatus, setShortcutStatus] = useState<string | null>(null);

  useEffect(() => {
    getPetScale()
      .then((scale) => {
        setPetScale(scale);
        emitPetScale(scale).catch(() => undefined);
      })
      .catch(() => undefined);

    getControlSettings()
      .then((saved) => setSettings({ ...defaultSettings, ...saved }))
      .catch(() => undefined);

    getOllamaHealth()
      .then((health) => setOllamaReady(health.ready))
      .catch(() => setOllamaReady(false));

    getOllamaModels()
      .then(setOllamaModels)
      .catch(() => setOllamaModels([]));

    getAccessibilityStatus()
      .then(setAccessibilityGranted)
      .catch(() => setAccessibilityGranted(false));

    getVoiceSettings()
      .then((saved) => {
        const next = { ...defaultVoiceSettings, ...saved };
        setVoiceSettingsState(next);
        setShortcutDraft(next.pushToTalkShortcut);
      })
      .catch(() => undefined);

    getVoiceModels()
      .then(setVoiceModels)
      .catch(() => setVoiceModels([]));
  }, []);

  useEffect(() => {
    const unlisten = listen<VoiceDownloadProgress>("voice-download-progress", (event) => {
      setVoiceDownloadProgress((current) => ({ ...current, [event.payload.modelId]: event.payload }));
    });

    return () => {
      unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (settings.provider !== "ollama" || ollamaModels.length === 0) return;
    if (ollamaModels.some((model) => model.name === settings.model)) return;

    const nextSettings = { ...settings, model: ollamaModels[0].name };
    setSettings(nextSettings);
    setControlSettings(nextSettings).catch(() => undefined);
  }, [ollamaModels, settings]);

  useEffect(() => {
    if (!settings.observationEnabled) return;

    let cancelled = false;

    async function observeWithPlanner() {
      try {
        const startedAt = performance.now();
        const result = await observeAndPlan({ settings, mood: action.mood, lastReactionKey });
        if (cancelled) return;

        setAccessibilityObservation(result.observation);
        setAccessibilityGranted(result.observation.trusted);
        setActiveApp(result.observation.activeApp);
        setSanitizedObservationContext(result.sanitizedContext);
        setLastObservationSkip(result.skippedReason);
        setRuntimeStatus((current) => ({ ...current, lastLatencyMs: Math.round(performance.now() - startedAt), lastError: null }));

        if (result.reactionKey) setLastReactionKey(result.reactionKey);
        if (result.action) await sendAction(result.action);
      } catch (error) {
        if (!cancelled) {
          setRuntimeStatus((current) => ({ ...current, lastError: String(error) }));
        }
      }
    }

    observeWithPlanner();
    const interval = window.setInterval(observeWithPlanner, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [action.mood, lastReactionKey, settings]);

  async function updateSettings(nextSettings: ControlSettings) {
    setSettings(nextSettings);
    await setControlSettings(nextSettings);
  }

  async function updateVoiceSettings(nextSettings: VoiceSettings) {
    setVoiceSettingsState(nextSettings);
    await setVoiceSettings(nextSettings);
  }

  async function saveShortcut() {
    const nextShortcut = shortcutDraft.trim();
    if (!nextShortcut) return;

    try {
      await validateVoiceShortcut(nextShortcut);
      await updateVoiceSettings({ ...voiceSettings, pushToTalkShortcut: nextShortcut });
      setShortcutStatus(`registered ${nextShortcut}`);
      setRuntimeStatus((current) => ({ ...current, lastError: null }));
    } catch (error) {
      setShortcutStatus(null);
      setRuntimeStatus((current) => ({ ...current, state: "error", lastError: String(error) }));
    }
  }

  async function downloadVoice(modelId: string) {
    setDownloadingVoiceModel(modelId);
    setRuntimeStatus((current) => ({ ...current, state: "thinking", lastError: null }));
    try {
      await downloadVoiceModel(modelId);
      const models = await getVoiceModels();
      setVoiceModels(models);
      await updateVoiceSettings({ ...voiceSettings, selectedModel: modelId, useLocalStt: true });
      setRuntimeStatus((current) => ({ ...current, state: "ready", lastError: null }));
    } catch (error) {
      setRuntimeStatus((current) => ({ ...current, state: "error", lastError: String(error) }));
    } finally {
      setDownloadingVoiceModel(null);
    }
  }

  async function sendAction(nextAction: PetAction) {
    setAction(nextAction);
    await emitPetAction(nextAction);
  }

  async function toggleClickThrough(next?: boolean) {
    const enabled = next ?? !clickThrough;
    setClickThrough(enabled);
    await emitClickThrough(enabled);
  }

  async function updatePetScale(nextScale: number) {
    const clamped = Math.min(Math.max(nextScale, 0.6), 1.7);
    setPetScale(clamped);
    await persistPetScale(clamped);
    await emitPetScale(clamped);
  }

  async function grantAccessibility() {
    const granted = await requestAccessibilityPermission();
    setAccessibilityGranted(granted);
    if (!granted) {
      setRuntimeStatus((current) => ({
        ...current,
        lastError: "Accessibility prompt opened. If Rocky is still not trusted, enable it in System Settings > Privacy & Security > Accessibility.",
      }));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;

    setMessage("");
    const startedAt = performance.now();
    setRuntimeStatus({ state: "thinking", lastLatencyMs: runtimeStatus.lastLatencyMs, lastError: null });
    await sendAction({ mood: "focused", animation: "think", speech: "Thinking with configured brain...", durationMs: 9000 });

    try {
      const result = await planPetAction({
        message: trimmed,
        model: settings.model,
        settings,
        context: { mood: action.mood, activeApp: summarizeObservation(activeApp, accessibilityObservation), idleSeconds: 0 },
      });
      setOllamaReady(settings.provider === "ollama" ? true : ollamaReady);
      setRuntimeStatus({ state: "ready", lastLatencyMs: Math.round(performance.now() - startedAt), lastError: null });
      await sendAction(result.action);
    } catch (error) {
      if (settings.provider === "ollama") setOllamaReady(false);
      setRuntimeStatus({ state: "error", lastLatencyMs: Math.round(performance.now() - startedAt), lastError: String(error) });
      await sendAction({ mood: "confused", animation: "confused", speech: "Configured brain did not answer.", durationMs: 9000 });
    }
  }

  return (
    <main className="min-h-screen w-screen overflow-auto bg-[linear-gradient(145deg,#141615,#090c0a)] p-6 text-emerald-50">
      <section className="grid min-h-[calc(100vh-48px)] gap-3 rounded-3xl border border-emerald-200/20 bg-zinc-950/80 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <header className="flex items-start justify-between gap-5">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-300">local companion</p>
            <h1 className="text-3xl font-semibold">Rocky Controls</h1>
          </div>
          <strong className={ollamaReady ? "text-emerald-300" : "text-amber-300"}>{ollamaReady ? "ollama ready" : ollamaReady === null ? "checking" : "offline"}</strong>
        </header>

        <div className="grid grid-cols-5 gap-1 rounded-2xl border border-emerald-100/10 bg-black/25 p-1">
          {tabs.map((item) => (
            <button key={item} className={`rounded-xl px-3 py-2 text-xs uppercase tracking-[0.08em] ${tab === item ? "bg-emerald-800/60" : "bg-transparent"}`} onClick={() => setTab(item)} type="button">
              {item}
            </button>
          ))}
        </div>

        {tab === "chat" && (
          <section className="grid gap-3">
            <ProviderPanel settings={settings} ollamaModels={ollamaModels} runtimeStatus={runtimeStatus} onChange={updateSettings} />
            <form onSubmit={submit} className="grid gap-3">
              <label className="grid gap-1.5">
                <span className="field-label">message</span>
                <textarea className="field" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask Rocky..." rows={5} />
              </label>
              <button className="btn" type="submit" disabled={runtimeStatus.state === "thinking"}>
                {runtimeStatus.state === "thinking" ? "thinking..." : "send to model"}
              </button>
              {runtimeStatus.lastError && <pre className="max-h-32 overflow-auto rounded-2xl border border-amber-300/30 bg-black/25 p-3 text-amber-100 whitespace-pre-wrap">{runtimeStatus.lastError}</pre>}
            </form>
          </section>
        )}

        {tab === "behavior" && (
          <section className="grid gap-3">
            <label className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-emerald-100/10 bg-black/20 p-3">
              <span className="field-label">pet size</span>
              <input className="accent-emerald-300" type="range" min="0.6" max="1.7" step="0.05" value={petScale} onChange={(event) => updatePetScale(Number(event.target.value))} />
              <strong>{Math.round(petScale * 100)}%</strong>
            </label>
            <ToggleRow label="quiet mode" checked={settings.quietMode} onChange={(quietMode) => updateSettings({ ...settings, quietMode })} />
            <ToggleRow label="observation" checked={settings.observationEnabled} onChange={(observationEnabled) => updateSettings({ ...settings, observationEnabled })} />
            <ToggleRow label="launch at login" checked={settings.launchAtLogin} onChange={(launchAtLogin) => updateSettings({ ...settings, launchAtLogin })} />
          </section>
        )}

        {tab === "voice" && (
          <section className="grid gap-3">
            <ToggleRow label="use local speech-to-text" checked={voiceSettings.useLocalStt} onChange={(useLocalStt) => updateVoiceSettings({ ...voiceSettings, useLocalStt })} />
            <label className="grid gap-1.5">
              <span className="field-label">push-to-talk shortcut</span>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input className="field" value={shortcutDraft} onChange={(event) => setShortcutDraft(event.target.value)} placeholder="Option+Space" />
                <button className="btn" type="button" onClick={saveShortcut}>
                  save
                </button>
              </div>
              <span className="text-xs text-emerald-100/55">
                Current: {voiceSettings.pushToTalkShortcut}. Examples: Option+Space, Command+Shift+R, Control+Option+Space.
              </span>
              {shortcutStatus && <span className="text-xs text-emerald-300">{shortcutStatus}</span>}
            </label>
            <StatusGrid
              rows={[
                ["selected model", voiceSettings.selectedModel],
                ["push-to-talk", voiceSettings.pushToTalkShortcut],
                ["recording engine", "Rust/cpal"],
                ["transcription engine", "local Whisper/Parakeet"],
                ["status", "voice ready"],
              ]}
            />
            <div className="grid gap-2">
              {voiceModels.map((model) => (
                <article key={model.id} className="grid gap-2 rounded-2xl border border-emerald-100/10 bg-black/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <strong>{model.name}</strong>
                        {model.isRecommended && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-emerald-200">recommended</span>}
                      </div>
                      <p className="text-sm text-emerald-100/70">{model.description}</p>
                      <p className="text-xs uppercase tracking-[0.08em] text-emerald-300/70">
                        {model.engine} · {model.sizeMb} MB
                      </p>
                    </div>
                    <button
                      className="btn"
                      disabled={downloadingVoiceModel !== null}
                      type="button"
                      onClick={() => (model.isDownloaded ? updateVoiceSettings({ ...voiceSettings, selectedModel: model.id, useLocalStt: true }) : downloadVoice(model.id))}
                    >
                      {downloadingVoiceModel === model.id ? "downloading..." : model.isDownloaded ? (voiceSettings.selectedModel === model.id ? "selected" : "select") : "download"}
                    </button>
                  </div>
                  {voiceDownloadProgress[model.id] && !voiceDownloadProgress[model.id].done && (
                    <div className="grid gap-1">
                      <div className="h-2 overflow-hidden rounded-full bg-black/40">
                        <div className="h-full rounded-full bg-emerald-300" style={{ width: `${voiceDownloadProgress[model.id].percent ?? 8}%` }} />
                      </div>
                      <p className="text-xs text-emerald-100/55">
                        {formatBytes(voiceDownloadProgress[model.id].downloadedBytes)}
                        {voiceDownloadProgress[model.id].totalBytes ? ` / ${formatBytes(voiceDownloadProgress[model.id].totalBytes)}` : ""} downloaded
                        {voiceDownloadProgress[model.id].percent !== null ? ` · ${Math.round(voiceDownloadProgress[model.id].percent)}%` : ""}
                      </p>
                    </div>
                  )}
                  {model.localPath && <p className="truncate text-xs text-emerald-100/45">{model.localPath}</p>}
                </article>
              ))}
            </div>
            {runtimeStatus.lastError && <pre className="max-h-32 overflow-auto rounded-2xl border border-amber-300/30 bg-black/25 p-3 text-amber-100 whitespace-pre-wrap">{runtimeStatus.lastError}</pre>}
          </section>
        )}

        {tab === "privacy" && (
          <section className="grid gap-3">
            <ToggleRow label="screen observation" checked={settings.observationEnabled} onChange={(observationEnabled) => updateSettings({ ...settings, observationEnabled })} />
            <ToggleRow label="quiet mode" checked={settings.quietMode} onChange={(quietMode) => updateSettings({ ...settings, quietMode })} />
            <ToggleRow label="click-through pet" checked={clickThrough} onChange={toggleClickThrough} />
            <StatusGrid
              rows={[
                ["provider", settings.provider],
                ["base url", settings.baseUrl],
                ["active app", activeApp?.name ?? "not observed"],
                ["window title", accessibilityObservation?.windowTitle ?? "unavailable"],
                ["focused role", accessibilityObservation?.focusedRole ?? "unavailable"],
                ["accessibility", accessibilityGranted === null ? "checking" : accessibilityGranted ? "granted" : "not granted"],
                ["planner skip", lastObservationSkip ?? "none"],
              ]}
            />
            <button className="btn" type="button" onClick={grantAccessibility}>
              {accessibilityGranted ? "accessibility granted" : "grant accessibility permission"}
            </button>
            <p className="text-xs leading-relaxed text-emerald-100/65">
              Basic observation only sees the active app. Accessibility permission is needed later for window titles, focused controls, and richer local context.
            </p>
          </section>
        )}

        {tab === "debug" && (
          <section className="grid gap-3">
            <StatusGrid
              rows={[
                ["mood", action.mood],
                ["animation", action.animation],
                ["latency", runtimeStatus.lastLatencyMs === null ? "none" : `${runtimeStatus.lastLatencyMs}ms`],
                ["state", runtimeStatus.state],
                ["observation", settings.observationEnabled ? "enabled" : "disabled"],
                ["accessibility", accessibilityGranted === null ? "checking" : accessibilityGranted ? "granted" : "not granted"],
                ["active app", activeApp?.name ?? "not observed"],
                ["window title", accessibilityObservation?.windowTitle ?? "unavailable"],
                ["focused role", accessibilityObservation?.focusedRole ?? "unavailable"],
                ["focused title", accessibilityObservation?.focusedTitle ?? "unavailable"],
                ["focused value", accessibilityObservation?.focusedValue ?? "unavailable"],
                ["selected text", accessibilityObservation?.selectedText ?? "unavailable"],
                ["sanitized context", sanitizedObservationContext || "none"],
                ["planner skip", lastObservationSkip ?? "none"],
                ["reaction key", lastReactionKey ?? "none"],
                ["bundle", activeApp?.bundleIdentifier ?? "unknown"],
              ]}
            />
            <div className="grid grid-cols-4 gap-2">
              {animations.map((animation) => (
                <button
                  className="btn"
                  key={animation}
                  onClick={() => sendAction({ mood: animation === "sleep" ? "sleepy" : animation === "confused" ? "confused" : "curious", animation, speech: animation === "idle" ? "I observe. Quiet rock mode." : `${animation}.`, durationMs: animation === "sleep" ? 14000 : 9000 })}
                >
                  {animation}
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => Window.getByLabel("pet").then((win) => win?.show())}>
              show pet
            </button>
            {runtimeStatus.lastError && <pre className="max-h-32 overflow-auto rounded-2xl border border-amber-300/30 bg-black/25 p-3 text-amber-100 whitespace-pre-wrap">{runtimeStatus.lastError}</pre>}
          </section>
        )}
      </section>
    </main>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function summarizeObservation(activeApp: ActiveApp | null, observation: AccessibilityObservation | null) {
  if (!activeApp) return null;

  const parts = [`app: ${activeApp.name}`];
  if (observation?.windowTitle) parts.push(`window: ${observation.windowTitle}`);
  if (observation?.focusedRole) parts.push(`focused role: ${observation.focusedRole}`);
  if (observation?.focusedTitle) parts.push(`focused title: ${observation.focusedTitle}`);
  if (observation?.selectedText) parts.push(`selected text: ${observation.selectedText}`);

  return parts.join("; ");
}

function StatusGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-emerald-100/10 bg-black/20 p-3">
      {rows.map(([label, value]) => (
        <>
          <span className="field-label" key={`${label}-label`}>
            {label}
          </span>
          <strong key={`${label}-value`}>{value}</strong>
        </>
      ))}
    </div>
  );
}
