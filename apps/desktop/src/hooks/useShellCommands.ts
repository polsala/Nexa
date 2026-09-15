import { useMemo, type Dispatch, type SetStateAction } from "react";
import { workspace, type Session } from "../../../../packages/shell/workspace";
import type { Kind } from "../../../../packages/editor-core/model";
import type { Action } from "../../../../packages/editor-core/engine";
interface Options {
  create: (kind: Kind) => void;
  open: () => Promise<void>;
  save: (session: Session | undefined, saveAs?: boolean) => Promise<boolean>;
  print: () => void | Promise<void>;
  closeSession: (session: Session) => Promise<void>;
  setFind: Dispatch<SetStateAction<false | "find" | "replace">>;
  setPalette: Dispatch<SetStateAction<boolean>>;
  setInspector: Dispatch<SetStateAction<boolean>>;
}
export function useShellCommands({
  create,
  open,
  save,
  print,
  closeSession,
  setFind,
  setPalette,
  setInspector,
}: Options) {
  return useMemo<Action[]>(
    () => [
      {
        id: "file.new",
        label: "newDocument",
        icon: "writer",
        shortcut: "Ctrl+N",
        execute: () => create("writer"),
      },
      {
        id: "file.newSheet",
        label: "newSpreadsheet",
        icon: "sheets",
        execute: () => create("sheets"),
      },
      {
        id: "file.newDeck",
        label: "newPresentation",
        icon: "slides",
        execute: () => create("slides"),
      },
      {
        id: "file.open",
        label: "open",
        icon: "open",
        shortcut: "Ctrl+O",
        execute: open,
      },
      {
        id: "file.save",
        label: "save",
        icon: "save",
        shortcut: "Ctrl+S",
        available: () => !!workspace.active()?.engine,
        execute: async () => {
          await save(workspace.active());
        },
      },
      {
        id: "file.saveAs",
        label: "saveAs",
        icon: "save",
        shortcut: "Ctrl+Shift+S",
        available: () => !!workspace.active()?.engine,
        execute: async () => {
          await save(workspace.active(), true);
        },
      },
      {
        id: "file.print",
        label: "print",
        icon: "print",
        shortcut: "Ctrl+P",
        available: () => !!workspace.active()?.engine,
        execute: print,
      },
      {
        id: "file.close",
        label: "close",
        icon: "close",
        shortcut: "Ctrl+W",
        available: () => !!workspace.active(),
        execute: async () => {
          const s = workspace.active();
          if (s) await closeSession(s);
        },
      },
      {
        id: "edit.undo",
        label: "undo",
        icon: "undo",
        shortcut: "Ctrl+Z",
        available: () => !!workspace.active()?.engine,
        execute: async () => {
          await workspace.active()?.engine?.undo();
        },
      },
      {
        id: "edit.redo",
        label: "redo",
        icon: "redo",
        shortcut: "Ctrl+Y",
        available: () => !!workspace.active()?.engine,
        execute: async () => {
          await workspace.active()?.engine?.redo();
        },
      },
      {
        id: "edit.find",
        label: "find",
        icon: "search",
        shortcut: "Ctrl+F",
        available: () => !!workspace.active()?.engine,
        execute: () => {
          setFind("find");
        },
      },
      {
        id: "edit.replace",
        label: "replace",
        icon: "search",
        shortcut: "Ctrl+H",
        available: () => !!workspace.active()?.engine,
        execute: () => {
          setFind("replace");
        },
      },
      {
        id: "view.palette",
        label: "commandPalette",
        icon: "search",
        shortcut: "Ctrl+K",
        execute: () => {
          setPalette(true);
        },
      },
      {
        id: "view.inspector",
        label: "inspector",
        icon: "inspector",
        available: () => !!workspace.active(),
        execute: () => {
          setInspector((v) => !v);
        },
      },
      {
        id: "view.settings",
        label: "settings",
        icon: "settings",
        execute: () => workspace.patch({ active: null, page: "settings" }),
      },
      {
        id: "view.home",
        label: "home",
        icon: "home",
        execute: () => workspace.patch({ active: null, page: "home" }),
      },
    ],
    [
      create,
      open,
      save,
      print,
      closeSession,
      setFind,
      setPalette,
      setInspector,
    ],
  );
}
