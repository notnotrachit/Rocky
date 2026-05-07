import { FormEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import RockyScene from "../RockyScene";
import { SpeechBubble } from "../components/SpeechBubble";
import { getAccessibilityObservation, getControlSettings, getPetScale, planPetAction, readScreenText, startVoiceRecording, stopVoiceRecordingAndTranscribe } from "../lib/commands";
import { defaultSettings, idleAction, type AccessibilityObservation, type ActiveApp, type PetAction } from "../types";

type ChatLine = {
  speaker: "human" | "rocky";
  text: string;
};

type VoiceState = "idle" | "listening" | "transcribing";

export function PetApp() {
  const [action, setAction] = useState<PetAction>(idleAction);
  const [clickThrough, setClickThrough] = useState(false);
  const [petScale, setPetScale] = useState(1);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLines, setChatLines] = useState<ChatLine[]>([
    { speaker: "rocky", text: "Ask, answer, teach. Rocky learn human things, question?" },
  ]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const pointerDownAt = useRef<{ x: number; y: number; time: number } | null>(null);
  const voiceRecording = useRef(false);
  const chatBusyRef = useRef(false);

  useEffect(() => {
    getPetScale().then(setPetScale).catch(() => undefined);

    const unlistenAction = listen<PetAction>("pet-action", (event) => setAction(event.payload));
    const unlistenClick = listen<boolean>("pet-click-through", (event) => setClickThrough(event.payload));
    const unlistenScale = listen<number>("pet-scale", (event) => setPetScale(event.payload));
    const unlistenVoiceStart = listen("voice-shortcut-start", () => {
      startVoice({ openChat: false }).catch((error) => setChatError(String(error)));
    });
    const unlistenVoiceStop = listen("voice-shortcut-stop", () => {
      stopVoice();
    });

    return () => {
      unlistenAction.then((dispose) => dispose());
      unlistenClick.then((dispose) => dispose());
      unlistenScale.then((dispose) => dispose());
      unlistenVoiceStart.then((dispose) => dispose());
      unlistenVoiceStop.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (chatBusy) return;
    if (action.animation === "idle") return;
    const timeout = window.setTimeout(() => setAction(idleAction), action.durationMs);
    return () => window.clearTimeout(timeout);
  }, [action, chatBusy]);

  useEffect(() => {
    chatBusyRef.current = chatBusy;
  }, [chatBusy]);

  useEffect(() => {
    getCurrentWindow().setIgnoreCursorEvents(clickThrough).catch(() => undefined);
  }, [clickThrough]);

  async function openControls() {
    const controls = await Window.getByLabel("controls");
    await controls?.show();
    await controls?.setFocus();
  }

  function handleRockyPointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    pointerDownAt.current = { x: event.clientX, y: event.clientY, time: performance.now() };
    getCurrentWindow().startDragging().catch(() => undefined);
  }

  function handleRockyPointerUp(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();

    const started = pointerDownAt.current;
    pointerDownAt.current = null;
    const distance = started ? Math.hypot(event.clientX - started.x, event.clientY - started.y) : 999;
    const elapsed = started ? performance.now() - started.time : 999;

    if (distance < 6 && elapsed < 240) {
      setChatOpen((open) => !open);
    }
  }

  async function sendMessage(trimmed: string) {
    setChatError(null);
    setChatBusy(true);
    emit("rocky-manual-busy", true).catch(() => undefined);
    setChatLines((lines) => [...lines, { speaker: "human", text: trimmed }]);
    setAction({ mood: "focused", animation: "think", speech: "Rocky thinking. Tiny gears no, rocks yes.", durationMs: 12_000 });

    try {
      const [settings, observation] = await Promise.all([
        getControlSettings().then((saved) => ({ ...defaultSettings, ...saved })),
        getAccessibilityObservation().catch(() => null),
      ]);
      const ocrText = settings.ocrEnabled && shouldReadScreen(trimmed)
        ? await readScreenText()
            .then((result) => result.text.trim())
            .catch((error) => `OCR failed: ${String(error)}`)
        : "";
      const message = ocrText ? `${trimmed}\n\nVisible screen OCR text:\n${ocrText}` : trimmed;
      const result = await planPetAction({
        message,
        model: settings.model,
        settings,
        context: { mood: action.mood, activeApp: summarizeObservation(observation), idleSeconds: 0 },
      });

      setAction(result.action);
      setChatLines((lines) => [...lines, { speaker: "rocky", text: result.action.speech }]);
    } catch (error) {
      const message = "Brain stumble. Try again, question?";
      setChatError(String(error));
      setAction({ mood: "confused", animation: "confused", speech: message, durationMs: 10_000 });
      setChatLines((lines) => [...lines, { speaker: "rocky", text: message }]);
    } finally {
      setChatBusy(false);
      emit("rocky-manual-busy", false).catch(() => undefined);
    }
  }

  async function sendChat(event: FormEvent) {
    event.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed || chatBusy) return;

    setChatInput("");
    await sendMessage(trimmed);
  }

  async function startVoice(options: { openChat: boolean } = { openChat: true }) {
    if (chatBusyRef.current || voiceRecording.current) return;

    try {
      await startVoiceRecording();
    } catch (error) {
      setChatError(`Could not start Rust voice recording: ${String(error)}`);
      setAction({ mood: "confused", animation: "confused", speech: "Microphone engine not ready. Rocky cannot hear.", durationMs: 10_000 });
      return;
    }

    voiceRecording.current = true;
    emit("rocky-manual-busy", true).catch(() => undefined);
    setVoiceState("listening");
    if (options.openChat) {
      setChatOpen(true);
    }
    setAction({ mood: "curious", animation: "inspect", speech: "Listening. Touch the wave.", durationMs: 20_000 });
  }

  async function stopVoice() {
    if (!voiceRecording.current) return;
    voiceRecording.current = false;
    setVoiceState("transcribing");

    try {
      const transcript = (await stopVoiceRecordingAndTranscribe()).trim();
      if (!transcript) {
        setVoiceState("idle");
        emit("rocky-manual-busy", false).catch(() => undefined);
        setAction({ mood: "confused", animation: "confused", speech: "Rocky hear silence. Try again, question?", durationMs: 9_000 });
        return;
      }

      setChatInput("");
      await sendMessage(transcript);
    } catch (error) {
      setChatError(String(error));
      emit("rocky-manual-busy", false).catch(() => undefined);
      setAction({ mood: "confused", animation: "confused", speech: "Local ears not wired yet. Soon, question?", durationMs: 10_000 });
    } finally {
      setVoiceState("idle");
    }
  }

  const rockyHeight = Math.round(250 * petScale);
  const rockyBottom = Math.round(14 + 10 * petScale);
  const speechTop = Math.max(58, 520 - rockyHeight - rockyBottom - 92);
  const controlsTop = Math.max(8, speechTop - 54);

  return (
    <main className="relative h-screen w-screen select-none overflow-hidden bg-[radial-gradient(ellipse_at_50%_84%,rgba(0,0,0,0.38),transparent_30%)]">
      <div className="absolute inset-0 z-10" onPointerDown={() => getCurrentWindow().startDragging().catch(() => undefined)} />
      <button
        className="absolute right-5 top-5 z-30 rounded-full border border-emerald-200/30 bg-zinc-950/60 px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-emerald-50/90 backdrop-blur-xl"
        style={{ top: controlsTop }}
        onClick={openControls}
        aria-label="Open controls"
      >
        rocky.sys
      </button>
      <div className="absolute inset-x-0 h-[300px]" style={{ bottom: rockyBottom, transform: `scale(${petScale})`, transformOrigin: "50% 100%" }}>
        <RockyScene animation={action.animation} interactive={false} />
      </div>
      <button
        className="absolute left-1/2 z-[25] w-[62%] -translate-x-1/2 rounded-[45%] bg-transparent"
        style={{ bottom: rockyBottom, height: rockyHeight }}
        aria-label="Chat with Rocky"
        onPointerDown={handleRockyPointerDown}
        onPointerUp={handleRockyPointerUp}
      />
      <SpeechBubble text={action.speech} mood={action.mood} top={speechTop} />
      {chatOpen && (
        <section
          className="absolute left-1/2 z-40 grid max-h-[220px] w-[330px] -translate-x-1/2 grid-rows-[auto_1fr_auto] gap-2 rounded-3xl border border-emerald-200/25 bg-zinc-950/88 p-3 text-emerald-50 shadow-2xl shadow-black/40 backdrop-blur-2xl"
          style={{ top: "12px" }}
        >
          <header className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-300">rocky mind link</p>
              <strong className="text-sm">Teach / ask / answer</strong>
            </div>
            <button className="rounded-full border border-emerald-100/20 px-2 py-1 text-xs" type="button" onClick={() => setChatOpen(false)}>
              close
            </button>
          </header>

          <div className="grid max-h-24 gap-2 overflow-auto rounded-2xl border border-emerald-100/10 bg-black/25 p-2 text-sm">
            {chatLines.slice(-8).map((line, index) => (
              <p key={`${line.speaker}-${index}`} className={line.speaker === "human" ? "text-right text-emerald-100" : "text-left text-stone-100"}>
                <span className="text-emerald-300/70">{line.speaker === "human" ? "you" : "rocky"}:</span> {line.text}
              </p>
            ))}
            {chatError && <p className="text-xs text-amber-200">{chatError}</p>}
          </div>

          <form className="grid grid-cols-[auto_1fr_auto] gap-2" onSubmit={sendChat}>
            <button
              className={`rounded-2xl border px-3 py-2 text-xs uppercase tracking-[0.08em] ${
                voiceState === "listening" ? "border-red-200/40 bg-red-950/70 text-red-100" : "border-emerald-200/25 bg-emerald-950/50"
              }`}
              disabled={chatBusy || voiceState === "transcribing"}
              onPointerDown={(event) => {
                event.preventDefault();
                startVoice().catch((error) => setChatError(String(error)));
              }}
              onPointerUp={(event) => {
                event.preventDefault();
                stopVoice();
              }}
              onPointerLeave={() => {
                if (voiceState === "listening") stopVoice();
              }}
              type="button"
            >
              {voiceState === "listening" ? "listening" : voiceState === "transcribing" ? "..." : "voice"}
            </button>
            <input
              className="rounded-2xl border border-emerald-100/15 bg-black/30 px-3 py-2 text-sm outline-none placeholder:text-emerald-100/35"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Answer Rocky..."
            />
            <button className="rounded-2xl border border-emerald-200/25 bg-emerald-900/70 px-3 py-2 text-xs uppercase tracking-[0.08em]" disabled={chatBusy} type="submit">
              {chatBusy ? "..." : "send"}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}

function summarizeObservation(observation: AccessibilityObservation | null) {
  const activeApp: ActiveApp | null | undefined = observation?.activeApp;
  if (!activeApp) return null;

  const parts = [`app: ${activeApp.name}`];
  if (observation?.windowTitle) parts.push(`window: ${observation.windowTitle}`);
  if (observation?.focusedRole) parts.push(`focused role: ${observation.focusedRole}`);
  if (observation?.focusedTitle) parts.push(`focused title: ${observation.focusedTitle}`);
  if (observation?.selectedText) parts.push(`selected text: ${observation.selectedText}`);

  return parts.join("; ");
}

function shouldReadScreen(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("read screen") || lower.includes("read my screen") || lower.includes("ocr") || lower.includes("what is on my screen") || lower.includes("what's on my screen");
}
