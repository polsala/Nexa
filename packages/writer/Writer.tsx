import { useEffect, useRef, useState, memo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import type { Action, EditorEngine, EditorHost } from "../editor-core/engine";
import type { Content, TextNode, Page } from "../editor-core/model";
import { readImageFile } from "../shell/files";
import {
  Button,
  ColourPicker,
  FontPicker,
  Icon,
  InspectorSection,
  NumberInput,
} from "../ui";
import type { Translator } from "../i18n";
import { PageBreak, ParagraphLayout, ResizableImage } from "./extensions";
interface Props {
  content: Extract<Content, { kind: "writer" }>;
  host: EditorHost;
  t: Translator;
  zoom: number;
  inspector: boolean;
}
function Writer({ content, host, t, zoom, inspector }: Props) {
  const [page, setPage] = useState(content.page);
  const pageRef = useRef(page);
  const [outline, setOutline] = useState<
    { text: string; level: number; pos: number }[]
  >([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  pageRef.current = page;
  // Creation must happen after commit: React can defer a lazy/Suspense commit
  // beyond Tiptap's abandoned-render cleanup timer.
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          protocols: ["http", "https", "mailto"],
          isAllowedUri: (url) => /^(https?:\/\/|mailto:|#)/i.test(url),
        },
      }),
      TableKit.configure({ table: { resizable: true } }),
      TextStyleKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      PageBreak,
      ParagraphLayout,
      ResizableImage,
    ],
    content: content.body,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: "writer-document",
        spellcheck: "true",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": t("document"),
      },
      handlePaste: (_view, event) => {
        const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
          f.type.startsWith("image/"),
        );
        if (!file) return false;
        // Claim a file-only clipboard synchronously, before decoding its image.
        event.preventDefault();
        void readImageFile(file)
          .then((image) =>
            editor
              ?.chain()
              .focus()
              .setImage({
                src: image.src,
                width: Math.min(500, image.width),
                height:
                  (Math.min(500, image.width) * image.height) / image.width,
              })
              .run(),
          )
          .catch(host.error);
        return true;
      },
      handleDrop: (_view, event) => {
        const f = event.dataTransfer?.files[0];
        if (!f?.type.startsWith("image/")) return false;
        event.preventDefault();
        void readImageFile(f)
          .then((image) =>
            editor
              ?.chain()
              .focus()
              .setImage({
                src: image.src,
                width: Math.min(500, image.width),
                height:
                  (Math.min(500, image.width) * image.height) / image.width,
              })
              .run(),
          )
          .catch(host.error);
        return true;
      },
    },
    onUpdate: () => {
      host.changed();
      clearTimeout(timer.current);
      timer.current = setTimeout(updateOutline, 500);
    },
    onSelectionUpdate: () => host.selectionChanged(),
  });
  function updateOutline() {
    if (!editor) return;
    const items: { text: string; level: number; pos: number }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading")
        items.push({
          text: node.textContent,
          level: Number(node.attrs.level),
          pos,
        });
    });
    setOutline(items);
  }
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const toggle = (
      id: string,
      label: Action["label"],
      run: () => boolean,
      active?: () => boolean,
      icon?: string,
    ): Action => ({
      id: `writer.${id}`,
      label,
      icon: icon ?? label,
      execute: run,
      active,
    });
    const actions: Action[] = [
      toggle(
        "toggleBold",
        "bold",
        () => editor.chain().focus().toggleBold().run(),
        () => editor.isActive("bold"),
      ),
      toggle(
        "toggleItalic",
        "italic",
        () => editor.chain().focus().toggleItalic().run(),
        () => editor.isActive("italic"),
      ),
      toggle(
        "toggleUnderline",
        "underline",
        () => editor.chain().focus().toggleUnderline().run(),
        () => editor.isActive("underline"),
      ),
      toggle(
        "toggleStrike",
        "strike",
        () => editor.chain().focus().toggleStrike().run(),
        () => editor.isActive("strike"),
      ),
      toggle(
        "superscript",
        "superscript",
        () => editor.chain().focus().toggleSuperscript().run(),
        () => editor.isActive("superscript"),
      ),
      toggle(
        "subscript",
        "subscript",
        () => editor.chain().focus().toggleSubscript().run(),
        () => editor.isActive("subscript"),
      ),
      ...(["left", "center", "right", "justify"] as const).map((align, i) =>
        toggle(
          `align.${align}`,
          (["alignLeft", "alignCenter", "alignRight", "justify"] as const)[i] ??
            "alignLeft",
          () => editor.chain().focus().setTextAlign(align).run(),
          () => editor.isActive({ textAlign: align }),
        ),
      ),
      toggle(
        "bullets",
        "bullets",
        () => editor.chain().focus().toggleBulletList().run(),
        () => editor.isActive("bulletList"),
      ),
      toggle(
        "numbers",
        "numbers",
        () => editor.chain().focus().toggleOrderedList().run(),
        () => editor.isActive("orderedList"),
      ),
      toggle("indent", "indent", () =>
        editor.isActive("listItem")
          ? editor.chain().focus().sinkListItem("listItem").run()
          : editor
              .chain()
              .focus()
              .updateAttributes(
                editor.isActive("heading") ? "heading" : "paragraph",
                {
                  indent: Math.min(
                    8,
                    Number(editor.getAttributes("paragraph").indent ?? 0) + 1,
                  ),
                },
              )
              .run(),
      ),
      toggle("outdent", "outdent", () =>
        editor.isActive("listItem")
          ? editor.chain().focus().liftListItem("listItem").run()
          : editor
              .chain()
              .focus()
              .updateAttributes(
                editor.isActive("heading") ? "heading" : "paragraph",
                {
                  indent: Math.max(
                    0,
                    Number(editor.getAttributes("paragraph").indent ?? 0) - 1,
                  ),
                },
              )
              .run(),
      ),
      ...([1, 2, 3] as const).map((level) =>
        toggle(
          `heading${level}`,
          `heading${level}`,
          () => editor.chain().focus().toggleHeading({ level }).run(),
          () => editor.isActive("heading", { level }),
          "text",
        ),
      ),
      toggle(
        "normal",
        "normal",
        () => editor.chain().focus().setParagraph().run(),
        undefined,
        "text",
      ),
      toggle(
        "insertTable",
        "table",
        () =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run(),
        undefined,
        "sheets",
      ),
      {
        ...toggle(
          "addRow",
          "addRow",
          () => editor.chain().focus().addRowAfter().run(),
          undefined,
          "row",
        ),
        available: () => editor.isActive("table"),
      },
      {
        ...toggle(
          "addColumn",
          "addColumn",
          () => editor.chain().focus().addColumnAfter().run(),
          undefined,
          "column",
        ),
        available: () => editor.isActive("table"),
      },
      {
        ...toggle(
          "deleteRow",
          "deleteRow",
          () => editor.chain().focus().deleteRow().run(),
          undefined,
          "delete",
        ),
        available: () => editor.isActive("table"),
      },
      {
        ...toggle(
          "deleteColumn",
          "deleteColumn",
          () => editor.chain().focus().deleteColumn().run(),
          undefined,
          "delete",
        ),
        available: () => editor.isActive("table"),
      },
      {
        ...toggle(
          "deleteTable",
          "deleteTable",
          () => editor.chain().focus().deleteTable().run(),
          undefined,
          "delete",
        ),
        available: () => editor.isActive("table"),
      },
      toggle(
        "horizontalRule",
        "horizontalRule",
        () => editor.chain().focus().setHorizontalRule().run(),
        undefined,
        "minus",
      ),
      toggle(
        "pageBreak",
        "pageBreak",
        () => editor.chain().focus().insertContent({ type: "pageBreak" }).run(),
        undefined,
        "writer",
      ),
      {
        id: "writer.link",
        label: "link",
        icon: "link",
        execute: async () => {
          const href = await host.prompt(
            "linkAddress",
            String(editor.getAttributes("link").href ?? "https://"),
          );
          if (href && /^(https?:\/\/|mailto:|#)/i.test(href))
            editor
              .chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href })
              .run();
        },
      },
      {
        id: "writer.insertImage",
        label: "image",
        icon: "image",
        execute: async () => {
          const img = await host.image();
          if (img)
            editor
              .chain()
              .focus()
              .setImage({
                src: img.src,
                width: Math.min(500, img.width),
                height: (Math.min(500, img.width) * img.height) / img.width,
              })
              .run();
        },
      },
    ];
    const engine: EditorEngine = {
      kind: "writer",
      actions,
      snapshot: () => ({
        kind: "writer",
        body: editor.getJSON() as TextNode,
        page: pageRef.current,
      }),
      undo: () => {
        editor.commands.undo();
      },
      redo: () => {
        editor.commands.redo();
      },
      focus: () => {
        editor.commands.focus();
      },
      setZoom: () => {},
      getText: () => editor.getText(),
      find: (query, replace) => {
        if (!query) return 0;
        const matches: { from: number; to: number }[] = [];
        editor.state.doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return;
          let index = node.text
            .toLocaleLowerCase()
            .indexOf(query.toLocaleLowerCase());
          while (index >= 0) {
            matches.push({ from: pos + index, to: pos + index + query.length });
            index = node.text
              .toLocaleLowerCase()
              .indexOf(query.toLocaleLowerCase(), index + query.length);
          }
        });
        if (replace !== undefined) {
          const transaction = editor.state.tr;
          for (const match of matches.reverse())
            transaction.insertText(replace, match.from, match.to);
          editor.view.dispatch(transaction);
        } else {
          const match =
            matches.find((m) => m.from > editor.state.selection.from) ??
            matches[0];
          if (match)
            editor
              .chain()
              .focus()
              .setTextSelection(match)
              .scrollIntoView()
              .run();
        }
        return matches.length;
      },
      dispose: () => {},
    };
    host.ready(engine);
    const timeout = setTimeout(() => {
      const items: { text: string; level: number; pos: number }[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading")
          items.push({
            text: node.textContent,
            level: Number(node.attrs.level),
            pos,
          });
      });
      setOutline(items);
    }, 0);
    return () => {
      clearTimeout(timeout);
      clearTimeout(timer.current);
    };
  }, [editor, host]);
  function updatePage(update: Partial<Page>) {
    setPage((p) => ({ ...p, ...update }));
    host.changed();
  }
  if (!editor)
    return (
      <div className="loading">
        <Icon name="loading" className="spin" />
        {t("loading")}
      </div>
    );
  return (
    <div className="writer-layout">
      <aside className="outline">
        <h3>{t("outline")}</h3>
        {outline.length ? (
          outline.map((h, i) => (
            <button
              key={i}
              style={{ paddingLeft: `${12 + (h.level - 1) * 12}px` }}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .setTextSelection(h.pos + 1)
                  .scrollIntoView()
                  .run()
              }
            >
              {h.text}
            </button>
          ))
        ) : (
          <p>{t("emptyOutline")}</p>
        )}
      </aside>
      <div className="writer-scroll">
        <div
          className="writer-ruler"
          style={{ width: (page.width * zoom) / 100 }}
        >
          {Array.from({ length: 17 }, (_, i) => (
            <span key={i}>{i}</span>
          ))}
        </div>
        <div
          className="writer-paper"
          style={{
            width: page.width,
            minHeight: page.height,
            padding: `${page.margins[0]}px ${page.margins[1]}px ${page.margins[2]}px ${page.margins[3]}px`,
            zoom: zoom / 100,
          }}
        >
          <div className="page-header">{page.header}</div>
          <EditorContent editor={editor} />
          <div className="page-footer">{page.footer}</div>
        </div>
      </div>
      {inspector && (
        <aside className="inspector">
          <InspectorSection title={t("format")}>
            <FontPicker
              label={t("fontSearch")}
              value="Arial"
              onChange={(font) =>
                editor.chain().focus().setFontFamily(font).run()
              }
            />
            <NumberInput
              label={t("fontSize")}
              value={parseFloat(
                String(editor.getAttributes("textStyle").fontSize ?? 12),
              )}
              min={6}
              max={200}
              onChange={(v) =>
                editor.chain().focus().setFontSize(`${v}pt`).run()
              }
            />
            <ColourPicker
              label={t("textColor")}
              value={String(
                editor.getAttributes("textStyle").color ?? "#182b29",
              )}
              onChange={(color) => editor.chain().focus().setColor(color).run()}
            />
            <ColourPicker
              label={t("highlight")}
              value="#fff1a6"
              onChange={(color) =>
                editor.chain().focus().setHighlight({ color }).run()
              }
            />
            <NumberInput
              label={t("lineSpacing")}
              value={Number(
                editor.getAttributes("paragraph").lineHeight ?? 1.6,
              )}
              min={1}
              max={3}
              step={0.1}
              onChange={(v) =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes(
                    editor.isActive("heading") ? "heading" : "paragraph",
                    { lineHeight: v },
                  )
                  .run()
              }
            />
            <NumberInput
              label={t("paragraphSpacing")}
              value={Number(editor.getAttributes("paragraph").spaceAfter ?? 10)}
              max={72}
              onChange={(v) =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes(
                    editor.isActive("heading") ? "heading" : "paragraph",
                    { spaceAfter: v },
                  )
                  .run()
              }
            />
          </InspectorSection>
          {editor.isActive("image") && (
            <InspectorSection title={t("image")}>
              <NumberInput
                label={t("width")}
                min={10}
                max={page.width}
                value={Number(editor.getAttributes("image").width ?? 400)}
                onChange={(width) => {
                  const attrs = editor.getAttributes("image");
                  editor
                    .chain()
                    .focus()
                    .updateAttributes("image", {
                      width,
                      height:
                        (width * Number(attrs.height ?? 300)) /
                        Number(attrs.width || 400),
                    })
                    .run();
                }}
              />
              <Button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .updateAttributes("image", { align: "center" })
                    .run()
                }
              >
                {t("alignCenter")}
              </Button>
              <Button
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .updateAttributes("image", { align: "wrap" })
                    .run()
                }
              >
                {t("alignLeft")}
              </Button>
            </InspectorSection>
          )}
          <InspectorSection title={t("pageSetup")}>
            <select
              aria-label={t("pageSize")}
              value={page.width > 800 && page.height > 1000 ? "letter" : "a4"}
              onChange={(e) =>
                updatePage(
                  e.target.value === "letter"
                    ? { width: 816, height: 1056 }
                    : { width: 794, height: 1123 },
                )
              }
            >
              <option value="a4">A4</option>
              <option value="letter">Letter</option>
            </select>
            <Button
              onClick={() =>
                updatePage({ width: page.height, height: page.width })
              }
            >
              <Icon name="rotate" />
              {page.width > page.height ? t("portrait") : t("landscape")}
            </Button>
            <NumberInput
              label={t("margins")}
              value={page.margins[0]}
              min={10}
              max={150}
              onChange={(v) => updatePage({ margins: [v, v, v, v] })}
            />
            <label>
              {t("header")}
              <input
                value={page.header}
                onChange={(e) => updatePage({ header: e.target.value })}
              />
            </label>
            <label>
              {t("footer")}
              <input
                value={page.footer}
                onChange={(e) => updatePage({ footer: e.target.value })}
              />
            </label>
          </InspectorSection>
        </aside>
      )}
    </div>
  );
}
export default memo(Writer);
