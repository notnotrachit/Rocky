import type { PetMood } from "../types";

export function SpeechBubble({ text, mood, top }: { text: string; mood: PetMood; top: number }) {
  return (
    <aside
      className="absolute left-1/2 z-20 w-[250px] -translate-x-1/2 rounded-[22px_22px_22px_8px] border border-emerald-300/25 bg-zinc-950/80 px-4 py-3 text-center text-[15px] leading-tight text-emerald-50 shadow-2xl shadow-black/30 backdrop-blur-xl"
      style={{ top: `max(14px, ${top}px)` }}
      data-mood={mood}
    >
      <span>{text}</span>
    </aside>
  );
}
