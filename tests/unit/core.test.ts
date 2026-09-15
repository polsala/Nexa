import { describe, it, expect } from "vitest";
import { History } from "../../packages/editor-core/history";
import {
  newDocument,
  cellAddress,
  parseDocument,
} from "../../packages/editor-core/model";
import { templates, makeTemplate } from "../../packages/editor-core/templates";
import { dictionaries, translator } from "../../packages/i18n";
import { shortcutMatches, CommandRegistry } from "../../packages/commands";
describe("editing transactions", () => {
  it("groups typing and preserves drag as one undo step", () => {
    const h = new History({ text: "", x: 0 });
    h.transact((d) => {
      d.text = "h";
    }, "typing");
    h.transact((d) => {
      d.text = "hello";
    }, "typing");
    h.transact((d) => {
      d.x = 40;
    });
    expect(h.undo()).toEqual({ text: "hello", x: 0 });
    expect(h.undo()).toEqual({ text: "", x: 0 });
    expect(h.redo().text).toBe("hello");
  });
  it("branches history after undo", () => {
    const h = new History({ x: 0 });
    h.transact((d) => {
      d.x = 1;
    });
    h.undo();
    h.transact((d) => {
      d.x = 2;
    });
    expect(h.canRedo).toBe(false);
  });
});
describe("document contracts", () => {
  it("has independent templates for each locale and type", () => {
    for (const locale of ["en", "ca", "es"] as const)
      for (const template of templates) {
        const d = makeTemplate(template, translator(locale));
        expect(parseDocument(d).content.kind).toBe(template.kind);
        expect(d.id).not.toBe(makeTemplate(template, translator(locale)).id);
      }
  });
  it("rejects future schema and bad identities", () => {
    expect(() =>
      parseDocument({ ...newDocument("writer", "Test"), schemaVersion: 8 }),
    ).toThrow();
    expect(cellAddress(0, 26)).toBe("AA1");
    expect(cellAddress(1048575, 16383)).toBe("XFD1048576");
  });
  it("ships complete locale keysets", () => {
    expect(Object.keys(dictionaries.ca).sort()).toEqual(
      Object.keys(dictionaries.en).sort(),
    );
    expect(Object.keys(dictionaries.es).sort()).toEqual(
      Object.keys(dictionaries.en).sort(),
    );
  });
});
describe("commands", () => {
  it("honours availability and executes one command", async () => {
    const r = new CommandRegistry();
    let n = 0;
    r.register([
      {
        id: "test",
        label: "save",
        available: () => false,
        execute: () => {
          n++;
        },
      },
    ]);
    await r.execute("test");
    expect(n).toBe(0);
    r.register([
      {
        id: "test",
        label: "save",
        execute: () => {
          n++;
        },
      },
    ]);
    await r.execute("test");
    expect(n).toBe(1);
  });
  it("matches modifier combinations exactly", () => {
    const event = {
      key: "S",
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent;
    expect(shortcutMatches(event, "Ctrl+Shift+S")).toBe(true);
    expect(shortcutMatches(event, "Ctrl+S")).toBe(false);
  });
});
