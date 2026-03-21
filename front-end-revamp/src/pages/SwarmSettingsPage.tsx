import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useSwarmStore } from "@/features/swarm/store";

const SwarmSettingsPage = () => {
  const settings = useSwarmStore((state) => state.settings);
  const updateSettings = useSwarmStore((state) => state.updateSettings);
  const hydrateSettings = useSwarmStore((state) => state.hydrateSettings);

  const [showOpenAi, setShowOpenAi] = useState(false);
  const [showLangSmith, setShowLangSmith] = useState(false);

  useEffect(() => {
    hydrateSettings();
  }, [hydrateSettings]);

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
      </header>

      <article className="rounded-xl border border-border/70 bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">API Configuration</h2>
        <div className="mt-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">OpenAI API Key</span>
            <div className="flex gap-2">
              <input
                type={showOpenAi ? "text" : "password"}
                value={settings.openAiApiKey}
                onChange={(event) => updateSettings({ openAiApiKey: event.target.value })}
                className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
              />
              <button onClick={() => setShowOpenAi((value) => !value)} className="h-10 rounded-xl border border-border bg-background px-3 text-muted-foreground">
                {showOpenAi ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">LangSmith API Key</span>
            <div className="flex gap-2">
              <input
                type={showLangSmith ? "text" : "password"}
                value={settings.langSmithApiKey}
                onChange={(event) => updateSettings({ langSmithApiKey: event.target.value })}
                className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
              />
              <button onClick={() => setShowLangSmith((value) => !value)} className="h-10 rounded-xl border border-border bg-background px-3 text-muted-foreground">
                {showLangSmith ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Backend URL</span>
            <input
              type="url"
              value={settings.backendUrl}
              onChange={(event) => updateSettings({ backendUrl: event.target.value })}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"
            />
          </label>
        </div>
      </article>

      <article className="rounded-xl border border-border/70 bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Preferences</h2>
        <div className="mt-4 space-y-2">
          <label className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2">
            <span className="text-sm text-foreground/90">Enable completion sound</span>
            <input
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={(event) => updateSettings({ soundEnabled: event.target.checked })}
              className="h-4 w-4 accent-primary"
            />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-border bg-background px-3 py-2">
            <span className="text-sm text-foreground/90">Auto-scroll debate log</span>
            <input
              type="checkbox"
              checked={settings.autoScrollDebate}
              onChange={(event) => updateSettings({ autoScrollDebate: event.target.checked })}
              className="h-4 w-4 accent-primary"
            />
          </label>
        </div>
      </article>
    </section>
  );
};

export default SwarmSettingsPage;
