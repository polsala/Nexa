import { lazy, Suspense, useMemo, memo, useEffect, useRef } from "react";
import type { Session } from "../../../../packages/shell/workspace";
import { workspace } from "../../../../packages/shell/workspace";
import type { Translator, MessageKey } from "../../../../packages/i18n";
import type { Language } from "../../../../packages/settings";
import type { EditorHost } from "../../../../packages/editor-core/engine";
import { chooseImage } from "../../../../packages/shell/files";
import { Icon } from "../../../../packages/ui";
const Writer = lazy(() => import("../../../../packages/writer/Writer"));
const Sheets = lazy(() => import("../../../../packages/sheets/Sheets"));
const Slides = lazy(() => import("../../../../packages/slides/Slides"));
interface Props {
  session: Session;
  t: Translator;
  prompt: (label: MessageKey, initial?: string) => Promise<string | null>;
  error: (error: unknown) => void;
  inspector: boolean;
  language: Language;
  dark: boolean;
  active: boolean;
  decimalSeparator: string;
}
function EditorView({
  session,
  t,
  prompt,
  error,
  inspector,
  language,
  dark,
  active,
  decimalSeparator,
}: Props) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const host = useMemo<EditorHost>(
    () => ({
      changed: () => {
        workspace.touch(session);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => workspace.refresh(), 400);
      },
      ready: (engine) => {
        session.engine = engine;
        workspace.refresh();
      },
      prompt,
      image: chooseImage,
      error,
      selectionChanged: () => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => workspace.refresh(), 100);
      },
    }),
    [session, prompt, error],
  );
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      session.engine = undefined;
    },
    [session],
  );
  const content = session.document.content;
  return (
    <Suspense
      fallback={
        <div className="loading">
          <Icon name="loading" className="spin" size={26} />
          {t("loading")}
        </div>
      }
    >
      {content.kind === "writer" ? (
        <Writer
          content={content}
          host={host}
          t={t}
          zoom={session.zoom}
          inspector={inspector}
        />
      ) : content.kind === "sheets" ? (
        <Sheets
          content={content}
          id={session.document.id}
          title={session.document.title}
          recoveryDraft={session.document.recoveryDraft}
          host={host}
          t={t}
          zoom={session.zoom}
          language={language}
          dark={dark}
          active={active}
          decimalSeparator={decimalSeparator}
        />
      ) : (
        <Slides
          content={content}
          host={host}
          t={t}
          zoom={session.zoom}
          inspector={inspector}
        />
      )}
    </Suspense>
  );
}
export default memo(EditorView);
