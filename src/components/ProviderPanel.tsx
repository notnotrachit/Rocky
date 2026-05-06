import type { ControlSettings, OllamaModel, Provider, RuntimeStatus } from "../types";

const providerDefaults: Record<Provider, Pick<ControlSettings, "model" | "baseUrl">> = {
  ollama: { model: "llama3.2", baseUrl: "http://127.0.0.1:11434" },
  openai: { model: "gpt-4o-mini", baseUrl: "" },
  anthropic: { model: "claude-3-5-haiku-latest", baseUrl: "" },
  google: { model: "gemini-1.5-flash", baseUrl: "" },
};

export function ProviderPanel({
  settings,
  ollamaModels,
  runtimeStatus,
  onChange,
}: {
  settings: ControlSettings;
  ollamaModels: OllamaModel[];
  runtimeStatus: RuntimeStatus;
  onChange: (settings: ControlSettings) => void;
}) {
  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="field-label">provider</span>
        <select
          className="field"
          value={settings.provider}
          onChange={(event) => {
            const provider = event.target.value as Provider;
            onChange({ ...settings, provider, ...providerDefaults[provider] });
          }}
        >
          <option value="ollama">Ollama</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google</option>
        </select>
      </label>

      <label className="grid gap-1.5">
        <span className="field-label">model</span>
        {settings.provider === "ollama" && ollamaModels.length > 0 ? (
          <select className="field" value={settings.model} onChange={(event) => onChange({ ...settings, model: event.target.value })}>
            {ollamaModels.map((model) => (
              <option key={model.name} value={model.name}>
                {model.name}
              </option>
            ))}
          </select>
        ) : (
          <input className="field" value={settings.model} onChange={(event) => onChange({ ...settings, model: event.target.value })} />
        )}
      </label>

      <label className="grid gap-1.5">
        <span className="field-label">base url</span>
        <input className="field" value={settings.baseUrl} onChange={(event) => onChange({ ...settings, baseUrl: event.target.value })} />
      </label>

      {settings.provider !== "ollama" && (
        <label className="grid gap-1.5">
          <span className="field-label">api key</span>
          <input className="field" type="password" value={settings.apiKey} onChange={(event) => onChange({ ...settings, apiKey: event.target.value })} />
        </label>
      )}

      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl border border-emerald-100/10 bg-black/20 p-3">
        <span className="field-label">health</span>
        <strong>{runtimeStatus.state}</strong>
        <span className="field-label">last speed</span>
        <strong>{runtimeStatus.lastLatencyMs === null ? "none" : `${runtimeStatus.lastLatencyMs}ms`}</strong>
      </div>
    </div>
  );
}
