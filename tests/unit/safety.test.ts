import { describe, it, expect } from "vitest";
import { withSessionIo, type IoSession } from "../../packages/shell/session-io";
import { replaceText } from "../../packages/editor-core/search";
import {
  newDocument,
  object,
  parseDocument,
  validateCellDraft,
} from "../../packages/editor-core/model";
import { pasteObjects, distribute } from "../../packages/slides/operations";
import { imageDimensions } from "../../packages/shell/image-safety";
import { workspace } from "../../packages/shell/workspace";
import type { EditorEngine } from "../../packages/editor-core/engine";
it("validates recovery draft identity, coordinates, kind and text bounds", () => {
  const document = newDocument("sheets", "Draft");
  if (document.content.kind !== "sheets") throw new Error("Wrong fixture kind");
  const draft = {
    version: 1,
    sheetId: document.content.workbook.sheets[0]?.id,
    row: 0,
    column: 0,
    text: "=SUM(A2:",
  };
  expect(validateCellDraft(draft, document.content).text).toBe(draft.text);
  for (const invalid of [
    { ...draft, version: 2 },
    { ...draft, sheetId: "missing" },
    { ...draft, row: -1 },
    { ...draft, column: 0.5 },
    { ...draft, column: 16384 },
    { ...draft, text: "é".repeat(1024 * 1024) },
  ]) {
    expect(() => validateCellDraft(invalid, document.content)).toThrow();
    expect(() =>
      parseDocument({ ...document, recoveryDraft: invalid }),
    ).toThrow();
  }
  expect(() =>
    validateCellDraft(draft, newDocument("writer", "Writer").content),
  ).toThrow();
});
it("captures draft text only for recovery and never mutates the committed cell", () => {
  const document = newDocument("sheets", "Draft");
  if (document.content.kind !== "sheets") throw new Error("Wrong fixture kind");
  const sheet = document.content.workbook.sheets[0];
  if (!sheet) throw new Error("Missing fixture worksheet");
  sheet.cells[0] = { 0: { value: 42 } };
  const draft = {
    version: 1 as const,
    sheetId: sheet.id,
    row: 0,
    column: 0,
    text: "=SUM(",
  };
  document.recoveryDraft = draft;
  const session = workspace.open({ document, path: null, warnings: [] });
  try {
    expect(session.dirty).toBe(true);
    expect(workspace.snapshot(session).recoveryDraft).toEqual(draft);
    const engine: EditorEngine = {
      kind: "sheets",
      snapshot: () => document.content,
      recoveryDraft: () => draft,
      actions: [],
      undo: () => {},
      redo: () => {},
      focus: () => {},
      setZoom: () => {},
      find: () => 0,
      getText: () => "",
      dispose: () => {},
    };
    session.engine = engine;
    expect(workspace.snapshot(session).recoveryDraft).toBeUndefined();
    const recovery = workspace.snapshot(session, true);
    expect(recovery.recoveryDraft).toEqual(draft);
    expect(recovery.recoveryDraft).not.toBe(draft);
    expect(sheet.cells[0]?.[0]?.value).toBe(42);
  } finally {
    workspace.close(session);
  }
});
describe("durable work ordering", () => {
  it("waits for autosave, then saves, then closes without dropping work", async () => {
    const session: IoSession = { busy: false };
    const steps: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const autosave = withSessionIo(session, async () => {
      await gate;
      steps.push("snapshot");
    });
    const save = withSessionIo(session, async () => {
      steps.push("save");
    });
    const close = withSessionIo(session, async () => {
      steps.push("close");
    });
    expect(session.busy).toBe(true);
    release();
    await Promise.all([autosave, save, close, session.pending]);
    expect(steps).toEqual(["snapshot", "save", "close"]);
    expect(session.busy).toBe(false);
  });
  it("does not poison subsequent saves after an I/O failure", async () => {
    const session: IoSession = { busy: false };
    await expect(
      withSessionIo(session, async () => {
        throw new Error("Disk full");
      }),
    ).rejects.toThrow("Disk full");
    expect(await withSessionIo(session, async () => "saved")).toBe("saved");
  });
});
it("replaces case-insensitively with literal queries and replacement text", () => {
  expect(replaceText("Café CAFÉ café", "café", "$1")).toBe("$1 $1 $1");
  expect(replaceText("a.b A.B ab", "a.b", "x")).toBe("x x ab");
});
it("copies slide objects with new identity and rejects untrusted URLs/geometry", () => {
  const o = object("rectangle", "Editable copy");
  const copy = pasteObjects(JSON.stringify([o]))[0];
  expect(copy?.id).not.toBe(o.id);
  expect(copy?.text).toBe(o.text);
  expect(() => pasteObjects(JSON.stringify([{ ...o, width: -1 }]))).toThrow();
  expect(() =>
    pasteObjects(
      JSON.stringify([
        { ...o, kind: "image", src: "https://example.com/tracker" },
      ]),
    ),
  ).toThrow();
});
it("distributes shapes using equal gaps, retaining outer edges", () => {
  const objects = [0, 60, 300].map((x) => ({
    ...object("rectangle"),
    x,
    width: 40,
  }));
  distribute(
    objects,
    objects.map((o) => o.id),
    "x",
  );
  expect(objects.map((o) => o.x)).toEqual([0, 150, 300]);
});
it("checks image dimensions before decoding pixels", () => {
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
    ),
    (c) => c.charCodeAt(0),
  );
  expect(imageDimensions(png)).toEqual({ width: 1, height: 1 });
  new DataView(png.buffer).setUint32(16, 65536);
  expect(() => imageDimensions(png)).toThrow();
  expect(() =>
    imageDimensions(new Uint8Array([255, 216, 255, 224, 0, 1])),
  ).toThrow();
});
