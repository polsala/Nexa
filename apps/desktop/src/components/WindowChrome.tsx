import { branding } from "../../../../packages/theme/branding";
import type { Translator } from "../../../../packages/i18n";
import {
  workspace,
  type Session,
  type Workspace,
  type Page,
} from "../../../../packages/shell/workspace";
import type { Kind } from "../../../../packages/editor-core/model";
import type { Action } from "../../../../packages/editor-core/engine";
import {
  Button,
  Icon,
  IconButton,
  Menu,
  MenuAction,
} from "../../../../packages/ui";
interface Props {
  state: Workspace;
  active: Session | undefined;
  t: Translator;
  go: (page: Page) => void;
  rename: (session: Session) => Promise<void>;
  setPalette: (open: boolean) => void;
  baseActions: Action[];
  execute: (action: Action) => void;
  setTabMenu: (menu: { id: string; x: number; y: number }) => void;
  closeSession: (session: Session) => Promise<void>;
  showError: (error: unknown) => void;
  create: (kind: Kind) => void;
}
export function WindowChrome({
  state,
  active,
  t,
  go,
  rename,
  setPalette,
  baseActions,
  execute,
  setTabMenu,
  closeSession,
  showError,
  create,
}: Props) {
  return (
    <>
      {" "}
      <header className="titlebar">
        <button
          className="wordmark"
          onClick={() => go("home")}
          aria-label={branding.name}
        >
          <span className="brand-mark">{branding.monogram}</span>
          <strong>{branding.shortName}</strong>
          <span>{branding.suffix}</span>
        </button>
        <nav className="application-menu" aria-label={t("file")}>
          {(["file", "edit", "view"] as const).map((group) => (
            <Menu key={group} label={t(group)}>
              {baseActions
                .filter((a) => a.id.startsWith(`${group}.`))
                .map((a) => (
                  <MenuAction key={a.id} action={a} t={t} execute={execute} />
                ))}
            </Menu>
          ))}
        </nav>
        <div className="titlebar-spacer" />
        {active && (
          <button
            className="document-title"
            onDoubleClick={() => {
              void rename(active);
            }}
            onClick={() => {
              void rename(active);
            }}
          >
            {active.document.title}
            <Icon name="chevron" size={12} />
          </button>
        )}
        <Button className="palette-trigger" onClick={() => setPalette(true)}>
          <Icon name="search" size={16} />
          <span>{t("commandPalette")}</span>
          <kbd>Ctrl K</kbd>
        </Button>
        <span className="privacy-badge">
          <Icon name="privacy" size={14} />
          {t("offline")}
        </span>
      </header>
      <div className="tabstrip" role="tablist" aria-label={t("document")}>
        <button
          role="tab"
          aria-selected={!active}
          className={`home-tab ${!active ? "active" : ""}`}
          onClick={() => go("home")}
        >
          <Icon name="home" size={16} />
          {t("home")}
        </button>
        {state.sessions.map((s) => (
          <div
            key={s.document.id}
            className={`document-tab ${active === s ? "active" : ""}`}
            onContextMenu={(e) => {
              e.preventDefault();
              setTabMenu({ id: s.document.id, x: e.clientX, y: e.clientY });
            }}
          >
            <button
              role="tab"
              aria-selected={active === s}
              onClick={() => workspace.patch({ active: s.document.id })}
            >
              <Icon name={s.document.content.kind} size={16} />
              <span>{s.document.title}</span>
              {s.dirty && <i className="dirty-dot" aria-label={t("unsaved")} />}
            </button>
            <IconButton
              icon="close"
              label={`${t("close")} ${s.document.title}`}
              onClick={() => {
                void closeSession(s).catch(showError);
              }}
            />
          </div>
        ))}
        <IconButton
          label={t("newDocument")}
          icon="plus"
          onClick={() => create("writer")}
        />
      </div>
    </>
  );
}
