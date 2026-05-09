import { FormEvent, PointerEvent, MouseEvent, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize, PhysicalPosition, Window } from "@tauri-apps/api/window";
import RockyScene from "../RockyScene";
import { SpeechBubble } from "../components/SpeechBubble";
import { captureScreenImage, getAccessibilityObservation, getControlSettings, getPetScale, planPetAction, planPetActionWithImage, quitApp, readScreenText, setControlSettings, setPetScale as persistPetScale, startVoiceRecording, stopVoiceRecordingAndTranscribe } from "../lib/commands";
import { defaultSettings, idleAction, type AccessibilityObservation, type ActiveApp, type PetAction, type PetToolCall } from "../types";

type ChatLine = {
  speaker: "human" | "rocky";
  text: string;
  imageDataUrl?: string;
};

type VoiceState = "idle" | "listening" | "transcribing";
type ContextMenuState = { x: number; y: number } | null;

const PET_BASE_WIDTH = 380;
const PET_BASE_SCENE_HEIGHT = 270;
const PET_BASE_ROCKY_HIT_HEIGHT = 230;
const PET_BASE_BOTTOM = 16;
const PET_MIN_UI_WIDTH = 380;
const PET_CHAT_HEIGHT = 210;
const PET_SPEECH_HEIGHT = 96;
const PET_VERTICAL_GAP = 18;

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
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const pointerDownAt = useRef<{ x: number; y: number; time: number } | null>(null);
  const voiceRecording = useRef(false);
  const chatBusyRef = useRef(false);
  const hideTimer = useRef<number | null>(null);
  const lastWindowFrame = useRef<{ width: number; height: number } | null>(null);
  const speechVisible = !isQuietObserveSpeech(action.speech);
  const scaledSceneWidth = Math.round(PET_BASE_WIDTH * petScale);
  const scaledSceneHeight = Math.round(PET_BASE_SCENE_HEIGHT * petScale);
  const needsPanelWidth = chatOpen || speechVisible || contextMenu !== null;
  const windowWidth = Math.max(needsPanelWidth ? PET_MIN_UI_WIDTH : 300, scaledSceneWidth);
  const contentTopHeight = chatOpen ? PET_CHAT_HEIGHT + PET_VERTICAL_GAP : speechVisible ? PET_SPEECH_HEIGHT + PET_VERTICAL_GAP : contextMenu !== null ? 48 : 0;
  const windowHeight = Math.round(contentTopHeight + scaledSceneHeight + PET_BASE_BOTTOM);

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
    const unlistenFocus = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (!payload) setContextMenu(null);
    });

    return () => {
      unlistenAction.then((dispose) => dispose());
      unlistenClick.then((dispose) => dispose());
      unlistenScale.then((dispose) => dispose());
      unlistenVoiceStart.then((dispose) => dispose());
      unlistenVoiceStop.then((dispose) => dispose());
      unlistenFocus.then((dispose) => dispose());
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
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

  useEffect(() => {
    const pet = getCurrentWindow();
    const previousFrame = lastWindowFrame.current;
    lastWindowFrame.current = { width: windowWidth, height: windowHeight };

    async function resizePetWindow() {
      try {
        if (previousFrame !== null && (previousFrame.width !== windowWidth || previousFrame.height !== windowHeight)) {
          const scaleFactor = await pet.scaleFactor();
          const position = await pet.outerPosition();
          const deltaX = Math.round(((previousFrame.width - windowWidth) / 2) * scaleFactor);
          const deltaY = Math.round((previousFrame.height - windowHeight) * scaleFactor);
          await pet.setPosition(new PhysicalPosition(position.x + deltaX, position.y + deltaY));
        }

        await pet.setSize(new LogicalSize(windowWidth, windowHeight));
      } catch (error) {
        console.error("Rocky window resize failed", error);
      }
    }

    resizePetWindow();
  }, [windowHeight, windowWidth]);

  async function openControls() {
    setContextMenu(null);
    const controls = await Window.getByLabel("controls");
    await controls?.show();
    await controls?.setFocus();
  }

  function openContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 210),
    });
  }

  async function hideFor(durationMs: number) {
    setContextMenu(null);
    const pet = getCurrentWindow();
    await pet.hide();
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      pet.show().catch(() => undefined);
      pet.setFocus().catch(() => undefined);
      hideTimer.current = null;
    }, durationMs);
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
    setAction({ mood: "focused", animation: "think", speech: "Thinking. Rocky arrange thought rocks...", durationMs: 20_000 });

    try {
      const [settings, observation] = await Promise.all([
        getControlSettings().then((saved) => ({ ...defaultSettings, ...saved })),
        getAccessibilityObservation().catch(() => null),
      ]);
      const ocrText = settings.ocrEnabled && shouldReadScreen(trimmed)
        ? await readScreenText()
            .then((result) => result.text.trim())
            .catch((error) => {
              console.error("Rocky manual OCR failed", error);
              return `OCR failed: ${formatError(error)}`;
            })
        : "";
      const message = ocrText ? `${trimmed}\n\nVisible screen OCR text:\n${ocrText}` : trimmed;
      const result = await planPetAction({
        message,
        model: settings.model,
        settings,
        context: { mood: action.mood, activeApp: summarizeObservation(observation), idleSeconds: 0 },
      });
      const toolCalls = withVisionFallback(result.action.toolCalls ?? [], trimmed, settings);

      if (toolCalls.some((tool) => tool.name === "captureScreen")) {
        await executeToolCalls(toolCalls, settings, message, observation);
      } else {
        setAction(result.action);
        setChatLines((lines) => [...lines, { speaker: "rocky", text: result.action.speech }]);
        await executeToolCalls(toolCalls, settings, message, observation);
      }
    } catch (error) {
      const message = "Brain stumble. Try again, question?";
      console.error("Rocky chat failed", error);
      setChatError(formatError(error));
      setAction({ mood: "confused", animation: "confused", speech: message, durationMs: 10_000 });
      setChatLines((lines) => [...lines, { speaker: "rocky", text: message }]);
    } finally {
      setChatBusy(false);
      emit("rocky-manual-busy", false).catch(() => undefined);
    }
  }

  async function executeToolCalls(toolCalls: PetToolCall[], settingsSnapshot = defaultSettings, originalMessage = "", observation: AccessibilityObservation | null = null) {
    for (const tool of toolCalls) {
      if (tool.name === "openControls") {
        await openControls();
      }

      if (tool.name === "showMemory") {
        emit("controls-tab", "memory").catch(() => undefined);
        await openControls();
      }

      if (tool.name === "toggleQuietMode") {
        const current = await getControlSettings().then((saved) => ({ ...defaultSettings, ...saved }));
        await setControlSettings({ ...current, quietMode: !current.quietMode });
        emit("controls-settings-updated", true).catch(() => undefined);
      }

      if (tool.name === "setPetScale") {
        const nextScale = Math.min(Math.max(Number(tool.argument ?? "1"), 0.6), 1.7);
        await persistPetScale(nextScale);
        setPetScale(nextScale);
        emit("pet-scale", nextScale).catch(() => undefined);
      }

      if (tool.name === "triggerOcr") {
        if (!settingsSnapshot.ocrEnabled) {
          setChatLines((lines) => [...lines, { speaker: "rocky", text: "OCR disabled. Enable screen reading in privacy controls, question?" }]);
          continue;
        }

        const text = await readScreenText().then((result) => result.text.trim()).catch((error) => {
          console.error("Rocky OCR tool failed", error);
          return `OCR failed: ${formatError(error)}`;
        });
        setChatLines((lines) => [...lines, { speaker: "rocky", text: text ? `OCR saw: ${text.slice(0, 220)}` : "OCR saw no text." }]);
      }

      if (tool.name === "captureScreen") {
        if (!settingsSnapshot.visionEnabled) {
          const text = "Vision disabled. Enable screen vision in privacy controls, question?";
          setAction({ mood: "confused", animation: "confused", speech: text, durationMs: 8_000 });
          setChatLines((lines) => [...lines, { speaker: "rocky", text }]);
          continue;
        }

        if (settingsSnapshot.provider !== "ollama") {
          const text = "Screen vision currently works with Ollama vision models only.";
          setAction({ mood: "confused", animation: "confused", speech: text, durationMs: 8_000 });
          setChatLines((lines) => [...lines, { speaker: "rocky", text }]);
          continue;
        }

        setAction({ mood: "focused", animation: "inspect", speech: "Looking at screen. Rocky feel photons secondhand...", durationMs: 20_000 });
        try {
          const image = await captureScreenImage();
          const imageDataUrl = `data:${image.mediaType};base64,${image.imageBase64}`;
          const result = await planPetActionWithImage({
            message: originalMessage,
            model: settingsSnapshot.model,
            settings: settingsSnapshot,
            context: { mood: action.mood, activeApp: summarizeObservation(observation), idleSeconds: 0 },
            imageBase64: image.imageBase64,
          });
          setAction(result.action);
          setChatLines((lines) => [...lines, { speaker: "rocky", text: result.action.speech, imageDataUrl }]);
        } catch (error) {
          console.error("Rocky screen vision failed", error);
          const text = formatError(error);
          setAction({ mood: "confused", animation: "confused", speech: text, durationMs: 10_000 });
          setChatLines((lines) => [...lines, { speaker: "rocky", text }]);
        }
      }
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
      console.error("Rocky voice recording failed to start", error);
      setChatError(`Could not start Rust voice recording: ${formatError(error)}`);
      setAction({ mood: "confused", animation: "confused", speech: "Microphone engine not ready. Rocky cannot hear.", durationMs: 10_000 });
      return;
    }

    voiceRecording.current = true;
    emit("rocky-manual-busy", true).catch(() => undefined);
    setVoiceState("listening");
    if (options.openChat) {
      setChatOpen(true);
    }
    setAction({ mood: "curious", animation: "inspect", speech: "Listening... sound waves touch Rocky.", durationMs: 20_000 });
  }

  async function stopVoice() {
    if (!voiceRecording.current) return;
    voiceRecording.current = false;
    setVoiceState("transcribing");
    setAction({ mood: "focused", animation: "think", speech: "Transcribing... Rocky translate sound.", durationMs: 20_000 });

    try {
      const transcript = (await stopVoiceRecordingAndTranscribe()).trim();
      if (!transcript) {
        setVoiceState("idle");
        emit("rocky-manual-busy", false).catch(() => undefined);
        setAction({ mood: "confused", animation: "confused", speech: "Rocky hear silence. Try again, question?", durationMs: 9_000 });
        return;
      }

      setChatInput("");
      setAction({ mood: "curious", animation: "talk", speech: `Heard: ${truncateSpeech(transcript)}`, durationMs: 2_000 });
      await wait(650);
      await sendMessage(transcript);
    } catch (error) {
      const message = formatError(error);
      if (isExpectedVoiceCancel(message)) {
        console.debug("Rocky voice cancelled", { message, error });
        setChatError(null);
        setAction({ mood: "confused", animation: "confused", speech: message, durationMs: 5_000 });
      } else {
        console.error("Rocky voice transcription failed", error);
        setChatError(message);
        setAction({ mood: "confused", animation: "confused", speech: "Local ears not wired yet. Soon, question?", durationMs: 10_000 });
      }
      emit("rocky-manual-busy", false).catch(() => undefined);
    } finally {
      setVoiceState("idle");
    }
  }

  const rockyHeight = Math.round(PET_BASE_ROCKY_HIT_HEIGHT * petScale);
  const rockyBottom = PET_BASE_BOTTOM;
  const sceneBottom = PET_BASE_BOTTOM;
  const speechTop = Math.max(12, contentTopHeight - PET_SPEECH_HEIGHT - 2);
  const chatWidth = Math.min(Math.max(windowWidth - 32, 330), 520);

  return (
    <main className="relative h-screen w-screen select-none overflow-hidden bg-[radial-gradient(ellipse_at_50%_84%,rgba(0,0,0,0.38),transparent_30%)]" onContextMenu={openContextMenu} onPointerDown={() => contextMenu && setContextMenu(null)}>
      <div
        className="absolute left-1/2"
        style={{
          bottom: sceneBottom,
          width: PET_BASE_WIDTH,
          height: PET_BASE_SCENE_HEIGHT,
          transform: `translateX(-50%) scale(${petScale})`,
          transformOrigin: "50% 100%",
        }}
      >
        <RockyScene animation={action.animation} interactive={false} />
      </div>
      <button
        className="absolute left-1/2 z-[25] -translate-x-1/2 rounded-[45%] bg-transparent"
        style={{ bottom: rockyBottom, width: Math.round(windowWidth * 0.64), height: rockyHeight }}
        aria-label="Chat with Rocky"
        onContextMenu={openContextMenu}
        onPointerDown={handleRockyPointerDown}
        onPointerUp={handleRockyPointerUp}
      />
      {!chatOpen && speechVisible && <SpeechBubble text={action.speech} mood={action.mood} top={speechTop} />}
      {contextMenu && (
        <div
          className="absolute z-50 grid w-44 gap-1 rounded-2xl border border-emerald-100/20 bg-zinc-950/95 p-2 text-sm text-emerald-50 shadow-2xl shadow-black/50 backdrop-blur-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button className="context-menu-item" type="button" onClick={openControls}>Open control panel</button>
          <button className="context-menu-item" type="button" onClick={() => hideFor(5 * 60_000)}>Hide for 5 min</button>
          <button className="context-menu-item" type="button" onClick={() => hideFor(30 * 60_000)}>Hide for 30 min</button>
          <button className="context-menu-item" type="button" onClick={() => hideFor(60 * 60_000)}>Hide for 1 hr</button>
          <button className="context-menu-item border-t border-emerald-100/10 text-amber-100" type="button" onClick={() => quitApp()}>Quit Rocky</button>
        </div>
      )}
      {chatOpen && (
        <section
          className="absolute left-1/2 z-40 grid max-h-[210px] -translate-x-1/2 grid-rows-[auto_1fr_auto] gap-2 rounded-3xl border border-emerald-200/25 bg-zinc-950/88 p-3 text-emerald-50 shadow-2xl shadow-black/40 backdrop-blur-2xl"
          style={{ top: "8px", width: chatWidth }}
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
              <div key={`${line.speaker}-${index}`} className={line.speaker === "human" ? "text-right text-emerald-100" : "text-left text-stone-100"}>
                {line.imageDataUrl && (
                  <img
                    className="mb-2 h-16 w-24 rounded-xl border border-emerald-100/15 object-cover opacity-85"
                    src={line.imageDataUrl}
                    alt="Captured screen preview"
                  />
                )}
                <p>
                  <span className="text-emerald-300/70">{line.speaker === "human" ? "you" : "rocky"}:</span> {line.text}
                </p>
              </div>
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

function isQuietObserveSpeech(speech: string) {
  const normalized = speech.trim().toLowerCase();
  return normalized === "i observe. quiet rock mode." || normalized === "i observe. quick rock mode.";
}

function shouldReadScreen(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("read screen") || lower.includes("read my screen") || lower.includes("ocr") || lower.includes("what is on my screen") || lower.includes("what's on my screen");
}

function shouldSeeScreen(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("see my screen") ||
    lower.includes("see on screen") ||
    lower.includes("what do you see") ||
    lower.includes("what's on my screen") ||
    lower.includes("what is on my screen") ||
    lower.includes("look at this") ||
    lower.includes("look at my screen") ||
    lower.includes("do you like this picture") ||
    lower.includes("describe this")
  );
}

function withVisionFallback(toolCalls: PetToolCall[], userMessage: string, settings: typeof defaultSettings): PetToolCall[] {
  if (!settings.visionEnabled || !shouldSeeScreen(userMessage)) return toolCalls;
  if (toolCalls.some((tool) => tool.name === "captureScreen")) return toolCalls;
  return [...toolCalls, { name: "captureScreen", argument: null }];
}

function truncateSpeech(text: string) {
  const trimmed = text.trim();
  return trimmed.length > 88 ? `${trimmed.slice(0, 85)}...` : trimmed;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatError(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    if ("message" in error && typeof error.message === "string") return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}

function isExpectedVoiceCancel(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("heard no audio") || lower.includes("heard silence") || lower.includes("hold voice") || lower.includes("no words to decode");
}
