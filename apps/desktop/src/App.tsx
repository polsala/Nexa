import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { branding } from "../../../packages/theme/branding";
import { translator, type MessageKey } from "../../../packages/i18n";
import {
  workspace,
  type Session,
  type Page,
} from "../../../packages/shell/workspace";
import * as files from "../../../packages/shell/files";
import { withSessionIo } from "../../../packages/shell/session-io";
import {
  type NexaDocument,
  type Kind,
  worksheetBounds,
} from "../../../packages/editor-core/model";
import {
  makeTemplate,
  type Template,
} from "../../../packages/editor-core/templates";
import { CommandRegistry, shortcutMatches } from "../../../packages/commands";
import type { Action } from "../../../packages/editor-core/engine";
import {
  Button,
  Dialog,
  Icon,
  IconButton,
  Menu,
  MenuAction,
  ProgressDialog,
  Toast,
  ToolbarButton,
} from "../../../packages/ui";
import { CommandPalette } from "../../../packages/ui/CommandPalette";
import { PrintView, stats } from "../../../packages/shell/PrintView";
import { Home } from "./components/Home";
import { Settings } from "./components/Settings";
import { Recovery } from "./components/Recovery";
import EditorView from "./components/EditorView";
import { WindowChrome } from "./components/WindowChrome";
import { WindowStatus } from "./components/WindowStatus";
import { useShellCommands } from "./hooks/useShellCommands";
interface Modal {
  kind: "prompt" | "close" | "confirm";
  label: MessageKey;
  value: string;
  text?: string;
  resolve: (value: string | null) => void;
}
export default function App() {
  const state = useSyncExternalStore(workspace.subscribe, workspace.get);
  const t = useMemo(
    () => translator(state.settings.language),
    [state.settings.language],
  );
  const active = state.sessions.find((s) => s.document.id === state.active);
  const [palette, setPalette] = useState(false);
  const [inspector, setInspector] = useState(true);
  const [modal, setModal] = useState<Modal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [find, setFind] = useState<false | "find" | "replace">(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matches, setMatches] = useState<number | null>(null);
  const [printing, setPrinting] = useState<NexaDocument | null>(null);
  const [systemDark, setSystemDark] = useState(
    matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [dragging, setDragging] = useState(false);
  const [tabMenu, setTabMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const busyRef = useRef<string | null>(null);
  const operationQueue = useRef(Promise.resolve());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const settingsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const closing = useRef(false);
  const dark =
    state.settings.theme === "dark" ||
    (state.settings.theme === "system" && systemDark);
  const showError = useCallback((err: unknown) => {
    const detail =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : JSON.stringify(err);
    if (!detail?.toLowerCase().includes("cancelled")) setError(detail);
  }, []);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }, []);
  const prompt = useCallback(
    (label: MessageKey, value = "") =>
      new Promise<string | null>((resolve) =>
        setModal({ kind: "prompt", label, value, resolve }),
      ),
    [],
  );
  const decide = useCallback(
    (label: MessageKey, text: string, kind: "close" | "confirm" = "close") =>
      new Promise<string | null>((resolve) =>
        setModal({ kind, label, value: "", text, resolve }),
      ),
    [],
  );
  const refreshFiles = useCallback(async () => {
    const [recent, recovery] = await Promise.all([
      files.listRecent(),
      files.listRecovery(),
    ]);
    workspace.patch({ recent, recovery });
  }, []);
  const runOperation = useCallback(
    <T,>(task: (operation: string) => Promise<T>): Promise<T | null> => {
      const work = operationQueue.current.then(async () => {
        const operation = files.operationId();
        busyRef.current = operation;
        setBusy(operation);
        try {
          return await task(operation);
        } catch (e) {
          showError(e);
          return null;
        } finally {
          busyRef.current = null;
          setBusy(null);
        }
      });
      operationQueue.current = work.then(() => {});
      return work;
    },
    [showError],
  );
  const save = useCallback(
    async (
      session: Session | undefined,
      saveAs = false,
      format?: string,
    ): Promise<boolean> => {
      if (!session) return false;
      return withSessionIo(session, async () => {
        await session.engine?.prepareSnapshot?.();
        const doc = workspace.snapshot(session);
        const result = await runOperation((operation) =>
          files.saveFile(doc, saveAs, operation, format),
        );
        if (!result) return false;
        if (!format) {
          session.path = result.path;
          session.savedRevision = result.revision;
          session.dirty = session.document.revision !== result.revision;
          session.snapshotRevision = result.revision;
          workspace.refresh();
          await refreshFiles();
        }
        notify(t(format ? "export" : "saved"));
        return format ? true : !session.dirty;
      });
    },
    [notify, refreshFiles, runOperation, t],
  );
  const closeSession = useCallback(
    async (session: Session) => {
      await session.pending;
      await session.engine?.prepareSnapshot?.();
      if (session.dirty) {
        const choice = await decide("closeDirty", session.document.title);
        if (!choice) return;
        if (choice === "save" && !(await save(session))) return;
      }
      await withSessionIo(session, async () => {
        await files.closeFile(session.document.id, true);
        workspace.close(session);
      });
      await refreshFiles();
    },
    [decide, save, refreshFiles],
  );
  const open = useCallback(async () => {
    const result = await runOperation(files.openFile);
    if (result) {
      workspace.open(result);
      await refreshFiles();
    }
  }, [runOperation, refreshFiles]);
  const openRecent = useCallback(
    async (id: string) => {
      const result = await runOperation((operation) =>
        files.openRecent(id, operation),
      );
      if (result) workspace.open(result);
    },
    [runOperation],
  );
  const create = useCallback(
    (kind: Kind) => {
      const s = workspace.create(
        kind,
        `${t("untitled")} ${state.sessions.length + 1}`,
      );
      if (
        s.document.content.kind === "writer" &&
        state.settings.defaultPageSize === "Letter"
      ) {
        s.document.content.page.width = 816;
        s.document.content.page.height = 1056;
      }
    },
    [state.sessions.length, state.settings.defaultPageSize, t],
  );
  const template = useCallback(
    (template: Template) =>
      workspace.open(
        { document: makeTemplate(template, t), path: null, warnings: [] },
        true,
      ),
    [t],
  );
  const print = useCallback(async () => {
    const session = workspace.active();
    if (!session) return;
    let doc: NexaDocument;
    try {
      await session.engine?.prepareSnapshot?.();
      doc = session.engine?.printSnapshot
        ? { ...session.document, content: session.engine.printSnapshot() }
        : workspace.snapshot(session);
    } catch (error) {
      showError(error);
      return;
    }
    if (doc.content.kind === "sheets") {
      const sheet = doc.content.workbook.sheets[0];
      if (sheet) {
        const { rows, columns: cols } = worksheetBounds(sheet);
        if (rows > 200 || cols > 50 || rows * cols > 10000) {
          showError(t("printLimit"));
          return;
        }
      }
    }
    setPrinting(doc);
  }, [showError, t]);
  const baseActions = useShellCommands({
    create,
    open,
    save,
    print,
    closeSession,
    setFind,
    setPalette,
    setInspector,
  });
  const registry = useMemo(() => {
    const r = new CommandRegistry();
    r.register(baseActions);
    r.register(active?.engine?.actions ?? []);
    return r;
  }, [baseActions, active?.engine]);
  const execute = useCallback(
    (action: Action) => {
      void registry.execute(action.id).catch(showError);
    },
    [registry, showError],
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const listener = () => setSystemDark(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.setProperty(
      "--accent",
      state.settings.accent,
    );
    document.documentElement.lang = state.settings.language;
  }, [dark, state.settings.accent, state.settings.language]);
  useEffect(() => {
    void (async () => {
      const settings = await files.getSettings();
      workspace.patch({ settings });
      await refreshFiles();
      if (workspace.get().recovery.length && !workspace.get().sessions.length)
        workspace.patch({ page: "recovery" });
    })().catch(showError);
  }, [refreshFiles, showError]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector(".slideshow")) return;
      // Preserve native editing/undo inside dialogs and shell form controls.
      if (modal || palette) return;
      const action = registry
        .list()
        .find(
          (a) =>
            a.shortcut &&
            a.available?.() !== false &&
            shortcutMatches(e, a.shortcut),
        );
      if (action) {
        if (
          ["edit.undo", "edit.redo"].includes(action.id) &&
          e.target instanceof HTMLElement &&
          e.target.closest("input,textarea,select") &&
          !e.target.closest(".univer-container")
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        if (!modal && !busyRef.current) execute(action);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [registry, execute, modal, palette]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!workspace.get().settings.recoveryEnabled || closing.current) return;
      for (const s of workspace.get().sessions) {
        if (
          !s.dirty ||
          s.busy ||
          s.snapshotRevision === s.document.revision ||
          !s.engine
        )
          continue;
        void withSessionIo(s, async () => {
          const doc = workspace.snapshot(s, true);
          await files.autosave(doc);
          s.snapshotRevision = doc.revision;
        }).catch(showError);
      }
    }, state.settings.autosaveSeconds * 1000);
    return () => clearInterval(timer);
  }, [state.settings.autosaveSeconds, showError]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (!files.desktop && workspace.get().sessions.some((s) => s.dirty))
        e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  useEffect(() => {
    if (!files.desktop) return;
    let disposed = false;
    const unregister: (() => void)[] = [];
    const add = (dispose: () => void) => {
      if (disposed) dispose();
      else unregister.push(dispose);
    };
    const opened = async (paths: string[]) => {
      for (const path of paths) {
        const result = await runOperation((operation) =>
          invoke<files.Opened>("open_granted", { path, operation }),
        );
        if (result) workspace.open(result);
      }
      await refreshFiles();
    };
    void listen<string[]>("nexa-open-files", (event) => {
      void opened(event.payload).catch(showError);
    })
      .then(add)
      .catch(showError);
    void invoke<string[]>("startup_files").then(opened).catch(showError);
    void listen<string>("nexa-file-changed", (event) => {
      const session = workspace
        .get()
        .sessions.find((s) => s.document.id === event.payload);
      if (session && !session.warnings.includes(t("externalChange"))) {
        session.warnings.push(t("externalChange"));
        workspace.refresh();
      }
    })
      .then(add)
      .catch(showError);
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing.current || busyRef.current) return;
        closing.current = true;
        try {
          for (const s of workspace.get().sessions)
            await s.engine?.prepareSnapshot?.();
          const dirty = workspace.get().sessions.filter((s) => s.dirty);
          if (dirty.length) {
            const choice = await decide(
              "closeDirty",
              dirty.map((s) => s.document.title).join("\n"),
            );
            if (!choice) return;
            if (choice === "save")
              for (const s of dirty) if (!(await save(s))) return;
          }
          for (const s of workspace.get().sessions)
            await withSessionIo(s, () => files.closeFile(s.document.id, true));
          await getCurrentWindow().destroy();
        } catch (e) {
          showError(e);
        } finally {
          closing.current = false;
        }
      })
      .then(add)
      .catch(showError);
    return () => {
      disposed = true;
      unregister.forEach((fn) => fn());
    };
  }, [runOperation, decide, save, showError, refreshFiles, t]);
  useEffect(() => {
    if (!printing) return;
    const after = () => setPrinting(null);
    window.addEventListener("afterprint", after);
    let cancelled = false;
    void document.fonts.ready.then(async () => {
      await Promise.all(
        Array.from(
          document.querySelectorAll<HTMLImageElement>("#print-root img"),
        ).map((img) => img.decode().catch(() => {})),
      );
      requestAnimationFrame(() => {
        if (!cancelled) window.print();
      });
    });
    return () => {
      cancelled = true;
      window.removeEventListener("afterprint", after);
    };
  }, [printing]);
  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [tabMenu]);
  const finishModal = (value: string | null) => {
    modal?.resolve(value);
    setModal(null);
  };
  const go = (page: Page) => {
    workspace.patch({ active: null, page });
    if (page === "recovery") void refreshFiles().catch(showError);
  };
  const restore = async (id: string) => {
    if (workspace.get().sessions.some((s) => s.document.id === id)) {
      workspace.patch({ active: id });
      return;
    }
    const result = await runOperation(() => files.restore(id));
    if (result) {
      workspace.open(result, true);
      notify(t("recovered"));
    }
  };
  const discardRecovery = async (id: string) => {
    if (await decide("recoveryDiscard", t("recoveryDiscardText"), "confirm")) {
      await files.discardRecovery(id);
      await refreshFiles();
    }
  };
  const rename = async (s: Session) => {
    const title = await prompt("name", s.document.title);
    if (title?.trim()) {
      s.document.title = title.trim();
      workspace.touch(s);
      workspace.refresh();
    }
  };
  const doFind = async (replace = false) => {
    if (active?.engine) {
      try {
        setMatches(
          await active.engine.find(query, replace ? replacement : undefined),
        );
      } catch (e) {
        showError(e);
      }
    }
  };
  const editorActions = active?.engine?.actions ?? [];
  const documentText = active?.engine?.getText() ?? "";
  const count = active ? stats(active.document, documentText) : 0;
  const shownActions = editorActions
    .filter(
      (a) =>
        ![
          "normal",
          "heading1",
          "heading2",
          "heading3",
          "deleteRow",
          "deleteColumn",
          "deleteTable",
          "deleteRows",
          "deleteColumns",
          "unfreeze",
          "clearFormat",
          "deleteSlide",
          "deleteObject",
          "bringFront",
          "sendBack",
          "subscript",
          "superscript",
        ].includes(a.label),
    )
    .slice(0, active?.document.content.kind === "writer" ? 12 : 10);
  return (
    <>
      <div
        className="app-shell"
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files") && !active) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDragging(false);
        }}
        onDrop={(e) => {
          if (active) return;
          e.preventDefault();
          setDragging(false);
          if (files.desktop) return;
          for (const f of Array.from(e.dataTransfer.files))
            void runOperation(() => files.openBrowserFile(f)).then((result) => {
              if (result) workspace.open(result);
            });
        }}
      >
        <WindowChrome
          state={state}
          active={active}
          t={t}
          go={go}
          rename={rename}
          setPalette={setPalette}
          baseActions={baseActions}
          execute={execute}
          setTabMenu={setTabMenu}
          closeSession={closeSession}
          showError={showError}
          create={create}
        />
        {active && (
          <>
            <div className="command-toolbar">
              <div className="toolbar-group">
                {baseActions
                  .filter((a) =>
                    ["file.save", "edit.undo", "edit.redo"].includes(a.id),
                  )
                  .map((a) => (
                    <ToolbarButton
                      key={a.id}
                      action={a}
                      t={t}
                      execute={execute}
                    />
                  ))}
              </div>
              {active.document.content.kind === "writer" && (
                <select
                  className="paragraph-picker"
                  aria-label={t("format")}
                  defaultValue="writer.normal"
                  onChange={(e) => {
                    void registry.execute(e.target.value).catch(showError);
                  }}
                >
                  {(
                    ["normal", "heading1", "heading2", "heading3"] as const
                  ).map((key) => (
                    <option key={key} value={`writer.${key}`}>
                      {t(key)}
                    </option>
                  ))}
                </select>
              )}
              <div className="toolbar-group adaptive-toolbar">
                {shownActions.map((a) => (
                  <ToolbarButton
                    key={a.id}
                    action={a}
                    t={t}
                    execute={execute}
                  />
                ))}
              </div>
              <Menu label={t("insert")} icon="plus">
                {editorActions.map((a) => (
                  <MenuAction key={a.id} action={a} t={t} execute={execute} />
                ))}
              </Menu>
              <div className="toolbar-spacer" />
              <Menu label={t("export")} icon="export">
                <button
                  role="menuitem"
                  onClick={() => {
                    void save(active, true);
                  }}
                >
                  {t("saveAs")} · .
                  {branding.nativeExtensions[active.document.content.kind]}
                </button>
                {files.desktop &&
                  (active.document.content.kind === "writer"
                    ? ["docx", "txt", "html"]
                    : active.document.content.kind === "sheets"
                      ? ["xlsx", "csv", "tsv"]
                      : ["pptx"]
                  ).map((format) => (
                    <button
                      role="menuitem"
                      key={format}
                      onClick={() => {
                        void save(active, false, format);
                      }}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                <button role="menuitem" onClick={print}>
                  <Icon name="print" size={16} />
                  {t("print")}
                </button>
              </Menu>
              <IconButton
                label={t("inspector")}
                icon="inspector"
                aria-pressed={inspector}
                onClick={() => setInspector((i) => !i)}
              />
            </div>
            {active.document.recoveryDraft && (
              <div className="compatibility-banner" role="status">
                {t("recoveredCellDraft")}
              </div>
            )}
            {active.warnings.length > 0 && (
              <details className="compatibility-banner">
                <summary>
                  <Icon name="warning" size={15} />
                  {t("compatibility")}
                  <span>{t("exportNotice")}</span>
                </summary>
                <ul>
                  {active.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            {find && (
              <form
                className="find-bar"
                onSubmit={(e) => {
                  e.preventDefault();
                  void doFind();
                }}
              >
                <Icon name="search" size={16} />
                <input
                  autoFocus
                  aria-label={t("find")}
                  placeholder={t("find")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <Button type="submit">{t("find")}</Button>
                {find === "replace" && (
                  <>
                    <input
                      aria-label={t("replace")}
                      placeholder={t("replace")}
                      value={replacement}
                      onChange={(e) => setReplacement(e.target.value)}
                    />
                    <Button
                      onClick={() => {
                        void doFind(true);
                      }}
                    >
                      {t("replaceAll")}
                    </Button>
                  </>
                )}
                {matches !== null && (
                  <span>
                    {matches} {t("matches")}
                  </span>
                )}
                <IconButton
                  label={t("close")}
                  icon="close"
                  onClick={() => setFind(false)}
                />
              </form>
            )}
          </>
        )}
        <div className={`main-area ${active ? "editing" : ""}`}>
          {!active && (
            <>
              <aside className="home-sidebar">
                <div className="sidebar-label">{branding.name}</div>
                <nav>
                  {(["home", "recent", "templates", "recovery"] as const).map(
                    (page) => (
                      <button
                        key={page}
                        aria-current={state.page === page ? "page" : undefined}
                        className={state.page === page ? "active" : ""}
                        onClick={() => go(page)}
                      >
                        <Icon name={page} size={18} />
                        <span>{t(page)}</span>
                        {page === "recovery" && state.recovery.length > 0 && (
                          <b>{state.recovery.length}</b>
                        )}
                      </button>
                    ),
                  )}
                </nav>
                <Button
                  className="sidebar-open"
                  onClick={() => {
                    void open();
                  }}
                >
                  <Icon name="open" />
                  {t("open")}
                </Button>
                <div className="sidebar-bottom">
                  <div className="local-card">
                    <Icon name="privacy" size={20} />
                    <strong>{t("offline")}</strong>
                    <span>{t("onDevice")}</span>
                  </div>
                  <button
                    onClick={() => go("settings")}
                    className={state.page === "settings" ? "active" : ""}
                  >
                    <Icon name="settings" />
                    {t("settings")}
                  </button>
                </div>
              </aside>
              {state.page === "settings" ? (
                <Settings
                  settings={state.settings}
                  t={t}
                  update={(settings) => {
                    workspace.patch({ settings });
                    clearTimeout(settingsTimer.current);
                    settingsTimer.current = setTimeout(() => {
                      void files.setSettings(settings).catch(showError);
                    }, 300);
                  }}
                />
              ) : state.page === "recovery" ? (
                <Recovery
                  files={state.recovery}
                  t={t}
                  locale={state.settings.locale}
                  restore={(id) => {
                    void restore(id).catch(showError);
                  }}
                  discard={(id) => {
                    void discardRecovery(id).catch(showError);
                  }}
                />
              ) : (
                <Home
                  t={t}
                  page={state.page}
                  recent={state.recent}
                  locale={state.settings.locale}
                  create={create}
                  open={() => {
                    void open();
                  }}
                  openRecent={(id) => {
                    void openRecent(id);
                  }}
                  template={template}
                />
              )}
            </>
          )}
          {state.sessions.map((s) => (
            <section
              key={s.document.id}
              className="editor-tab-panel"
              hidden={active !== s}
              inert={active !== s}
              aria-label={s.document.title}
            >
              {(active === s || s.engine) && (
                <EditorView
                  session={s}
                  t={t}
                  prompt={prompt}
                  error={showError}
                  inspector={inspector}
                  language={state.settings.language}
                  dark={dark}
                  active={active === s && !palette && !modal && !busy}
                  decimalSeparator={state.settings.decimalSeparator}
                />
              )}
            </section>
          ))}
        </div>
        <WindowStatus
          active={active}
          count={count}
          characterCount={
            active?.document.content.kind === "writer"
              ? documentText.length -
                (documentText.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)
                  ?.length ?? 0)
              : undefined
          }
          locale={state.settings.locale}
          t={t}
        />
        {dragging && (
          <div className="drop-overlay">
            <Icon name="open" size={44} />
            <h2>{t("dropFiles")}</h2>
          </div>
        )}
      </div>
      {palette && (
        <CommandPalette
          t={t}
          actions={registry.list()}
          close={() => setPalette(false)}
          execute={execute}
        />
      )}
      {modal && (
        <Dialog title={t(modal.label)} close={() => finishModal(null)}>
          {modal.kind === "prompt" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                finishModal(modal.value);
              }}
            >
              <input
                autoFocus
                aria-label={t(modal.label)}
                value={modal.value}
                onChange={(e) => setModal({ ...modal, value: e.target.value })}
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="dialog-actions">
                <Button onClick={() => finishModal(null)}>{t("cancel")}</Button>
                <Button className="primary" type="submit">
                  {t("done")}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p>{modal.kind === "close" ? t("closeDirtyText") : modal.text}</p>
              {modal.kind === "close" && (
                <p className="modal-document-names">{modal.text}</p>
              )}
              <div className="dialog-actions">
                <Button onClick={() => finishModal(null)}>{t("cancel")}</Button>
                {modal.kind === "close" && (
                  <Button onClick={() => finishModal("discard")}>
                    {t("discard")}
                  </Button>
                )}
                <Button
                  className="primary"
                  onClick={() =>
                    finishModal(modal.kind === "close" ? "save" : "confirm")
                  }
                >
                  {t(modal.kind === "close" ? "save" : "confirm")}
                </Button>
              </div>
            </>
          )}
        </Dialog>
      )}
      {busy && (
        <ProgressDialog
          t={t}
          cancel={() => {
            void files.cancelOperation(busy).catch(showError);
          }}
        />
      )}
      {error && (
        <Dialog title={t("errorTitle")} close={() => setError(null)}>
          <p>{t("errorMessage")}</p>
          <details className="error-details">
            <summary>{t("technicalDetails")}</summary>
            <pre>{error}</pre>
            <Button
              onClick={() => {
                void navigator.clipboard
                  .writeText(error)
                  .then(() => notify(t("copyDetails")))
                  .catch(() => {});
              }}
            >
              {t("copyDetails")}
            </Button>
          </details>
          <div className="dialog-actions">
            <Button className="primary" onClick={() => setError(null)}>
              {t("done")}
            </Button>
          </div>
        </Dialog>
      )}
      {toast && <Toast text={toast} />}
      {tabMenu && (
        <div
          className="tab-context-menu"
          style={{ left: tabMenu.x, top: tabMenu.y }}
          role="menu"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(["rename", "saveAs", "close"] as const).map((key) => (
            <button
              role="menuitem"
              key={key}
              onClick={() => {
                const s = state.sessions.find(
                  (s) => s.document.id === tabMenu.id,
                );
                setTabMenu(null);
                if (s)
                  void (
                    key === "rename"
                      ? rename(s)
                      : key === "saveAs"
                        ? save(s, true)
                        : closeSession(s)
                  ).catch(showError);
              }}
            >
              {t(key)}
            </button>
          ))}
        </div>
      )}
      {printing && <PrintView document={printing} />}
    </>
  );
}
