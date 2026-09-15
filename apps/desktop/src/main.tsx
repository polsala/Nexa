import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { branding } from "../../../packages/theme/branding";
import { translator } from "../../../packages/i18n";
import { workspace } from "../../../packages/shell/workspace";
import "../../../packages/theme/tokens.css";
import "./styles.css";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(error.name, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    const t = translator(workspace.get().settings.language);
    return (
      <main className="fatal-error">
        <h1>{branding.name}</h1>
        <h2>{t("errorTitle")}</h2>
        <p>{t("errorMessage")}</p>
        <details>
          <summary>{t("technicalDetails")}</summary>
          <pre>{this.state.error}</pre>
        </details>
        <button onClick={() => location.reload()}>{t("recovery")}</button>
      </main>
    );
  }
}
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
performance.mark("nexa-shell-mounted");
