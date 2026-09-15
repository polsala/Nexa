import type {
  Settings as SettingsModel,
  Language,
} from "../../../../packages/settings";
import type { Translator } from "../../../../packages/i18n";
import { ColourPicker, Icon, NumberInput } from "../../../../packages/ui";
export function Settings({
  settings,
  t,
  update,
}: {
  settings: SettingsModel;
  t: Translator;
  update: (settings: SettingsModel) => void;
}) {
  const patch = (s: Partial<SettingsModel>) => update({ ...settings, ...s });
  return (
    <main className="settings-page">
      <div className="page-heading">
        <span className="eyebrow">{t("settings")}</span>
        <h1>{t("settingsTitle")}</h1>
        <p>{t("settingsText")}</p>
      </div>
      <section className="settings-card">
        <h2>{t("theme")}</h2>
        <div className="theme-options">
          {(["system", "light", "dark"] as const).map((theme) => (
            <button
              key={theme}
              aria-pressed={settings.theme === theme}
              onClick={() => patch({ theme })}
            >
              <div className={`theme-preview theme-${theme}`}>
                <i />
                <span />
                <b />
              </div>
              <span>{t(theme)}</span>
              {settings.theme === theme && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
        <ColourPicker
          label={t("accent")}
          value={settings.accent}
          onChange={(accent) => patch({ accent })}
        />
      </section>
      <section className="settings-card">
        <h2>{t("language")}</h2>
        <div className="settings-fields">
          <label>
            {t("language")}
            <select
              value={settings.language}
              onChange={(e) => patch({ language: e.target.value as Language })}
            >
              <option value="en">English</option>
              <option value="ca">Català</option>
              <option value="es">Español</option>
            </select>
          </label>
          <label>
            {t("locale")}
            <select
              value={settings.locale}
              onChange={(e) => patch({ locale: e.target.value })}
            >
              <option value="en-US">English · 1,234.56</option>
              <option value="ca-ES">Català · 1.234,56</option>
              <option value="es-ES">Español · 1.234,56</option>
            </select>
          </label>
          <label>
            {t("pageSize")}
            <select
              value={settings.defaultPageSize}
              onChange={(e) => patch({ defaultPageSize: e.target.value })}
            >
              <option>A4</option>
              <option>Letter</option>
            </select>
          </label>
          <label>
            {t("separators")}
            <select
              value={settings.decimalSeparator}
              onChange={(e) => patch({ decimalSeparator: e.target.value })}
            >
              <option value=".">.</option>
              <option value=",">,</option>
            </select>
          </label>
        </div>
      </section>
      <section className="settings-card">
        <h2>{t("recovery")}</h2>
        <NumberInput
          label={t("autosave")}
          min={5}
          max={3600}
          value={settings.autosaveSeconds}
          onChange={(autosaveSeconds) => patch({ autosaveSeconds })}
        />
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={settings.recoveryEnabled}
            onChange={(e) => patch({ recoveryEnabled: e.target.checked })}
          />
          {t("recoveryEnabled")}
        </label>
        <p className="muted">
          {t("updates")}: {t("manualUpdates")}
        </p>
      </section>
      <div className="privacy-note">
        <Icon name="privacy" size={24} />
        <p>{t("privacy")}</p>
      </div>
    </main>
  );
}
