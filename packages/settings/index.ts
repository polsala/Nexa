import { branding } from "../theme/branding";
export type Language = "en" | "ca" | "es";
export interface Settings {
  schemaVersion: number;
  theme: "system" | "light" | "dark";
  accent: string;
  language: Language;
  autosaveSeconds: number;
  defaultPageSize: string;
  locale: string;
  decimalSeparator: string;
  recoveryEnabled: boolean;
  updatePreference: string;
}
export const defaults: Settings = {
  schemaVersion: 1,
  theme: "system",
  accent: branding.accent,
  language: "en",
  autosaveSeconds: 30,
  defaultPageSize: "A4",
  locale: "en-US",
  decimalSeparator: ".",
  recoveryEnabled: true,
  updatePreference: "manual",
};
