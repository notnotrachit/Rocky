export function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-100/10 bg-black/20 p-3">
      <span className="text-[11px] uppercase tracking-[0.12em] text-emerald-50/60">{label}</span>
      <input className="h-4 w-4 accent-emerald-300" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
