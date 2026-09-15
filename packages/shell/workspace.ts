import {
  newDocument,
  type Kind,
  type NexaDocument,
} from "../editor-core/model";
import type { EditorEngine } from "../editor-core/engine";
import { defaults, type Settings } from "../settings";
import type { Recent, Recovery, Opened } from "./files";
export interface Session {
  document: NexaDocument;
  path: string | null;
  engine?: EditorEngine;
  dirty: boolean;
  warnings: string[];
  zoom: number;
  savedRevision: number;
  snapshotRevision: number;
  busy: boolean;
  pending?: Promise<void>;
}
export type Page = "home" | "recent" | "templates" | "recovery" | "settings";
export interface Workspace {
  sessions: Session[];
  active: string | null;
  page: Page;
  settings: Settings;
  recent: Recent[];
  recovery: Recovery[];
  revision: number;
}
let state: Workspace = {
  sessions: [],
  active: null,
  page: "home",
  settings: defaults,
  recent: [],
  recovery: [],
  revision: 0,
};
const listeners = new Set<() => void>();
export const workspace = {
  get: () => state,
  subscribe: (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  patch: (value: Partial<Workspace>) => {
    state = { ...state, ...value, revision: state.revision + 1 };
    listeners.forEach((fn) => fn());
  },
  refresh: () => workspace.patch({}),
  active: () => state.sessions.find((s) => s.document.id === state.active),
  open: (opened: Opened, dirty = false): Session => {
    const existing = state.sessions.find(
      (s) => s.document.id === opened.document.id,
    );
    if (existing) {
      workspace.patch({ active: existing.document.id });
      return existing;
    }
    const session: Session = {
      ...opened,
      dirty: dirty || !!opened.document.recoveryDraft,
      zoom: 100,
      savedRevision: dirty ? -1 : opened.document.revision,
      snapshotRevision: -1,
      busy: false,
    };
    workspace.patch({
      sessions: [...state.sessions, session],
      active: session.document.id,
    });
    return session;
  },
  create: (kind: Kind, title: string) =>
    workspace.open(
      { document: newDocument(kind, title), path: null, warnings: [] },
      true,
    ),
  touch: (session: Session) => {
    session.document.revision++;
    session.document.modifiedAt = Date.now();
    if (!session.dirty) {
      session.dirty = true;
      workspace.refresh();
    }
  },
  snapshot: (session: Session, recovery = false): NexaDocument => {
    // Never drop an unresolved draft before its editor has initialized.
    if (!session.engine) return { ...session.document };
    const result: NexaDocument = {
      ...session.document,
      content: session.engine.snapshot(),
    };
    delete result.recoveryDraft;
    const draft = recovery ? session.engine.recoveryDraft?.() : undefined;
    if (draft) result.recoveryDraft = { ...draft };
    return result;
  },
  close: (session: Session) => {
    const sessions = state.sessions.filter((s) => s !== session);
    workspace.patch({
      sessions,
      active:
        state.active === session.document.id
          ? (sessions.at(-1)?.document.id ?? null)
          : state.active,
    });
  },
};
