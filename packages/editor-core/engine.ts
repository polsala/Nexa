import type { CellDraft, Content, Kind } from "./model";
import type { MessageKey } from "../i18n";
export interface Action {
  id: string;
  label: MessageKey;
  shortcut?: string;
  icon?: string;
  available?: () => boolean;
  active?: () => boolean;
  execute: (value?: string) => void | boolean | Promise<void | boolean>;
}
export interface EditorEngine {
  kind: Kind;
  /** Commit an in-progress input before explicit save/export/print/close. */
  prepareSnapshot?(): Promise<void>;
  snapshot(): Content;
  /** Non-mutating, lightweight draft capture for timed recovery only. */
  recoveryDraft?(): CellDraft | undefined;
  /** A bounded, display-ready print selection; never replaces saved content. */
  printSnapshot?(): Content;
  actions: Action[];
  undo(): void | Promise<unknown>;
  redo(): void | Promise<unknown>;
  focus(): void;
  setZoom(zoom: number): void;
  find(query: string, replace?: string): number | Promise<number>;
  getText(): string;
  dispose(): void;
}
export interface EditorHost {
  changed(): void;
  ready(engine: EditorEngine): void;
  prompt(label: MessageKey, initial?: string): Promise<string | null>;
  image(): Promise<{ src: string; width: number; height: number } | null>;
  error(error: unknown): void;
  selectionChanged(): void;
}
