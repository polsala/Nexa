import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import type { SlideObject, TextNode } from "../editor-core/model";
import type { Translator } from "../i18n";
export function SlideTextEditor({
  object,
  change,
  finish,
  t,
}: {
  object: SlideObject;
  change: (text: string, rich: TextNode) => void;
  finish: () => void;
  t: Translator;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        link: false,
      }),
      TextStyleKit,
    ],
    content: object.richText ?? {
      type: "doc",
      content: object.text.split("\n").map((text) => ({
        type: "paragraph",
        content: text ? [{ type: "text", text }] : [],
      })),
    },
    onUpdate: ({ editor }) =>
      change(editor.getText(), editor.getJSON() as TextNode),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": t("textBox"),
        spellcheck: "true",
      },
      handleKeyDown: (_view, e) => {
        if (e.key === "Escape") {
          finish();
          return true;
        }
        return false;
      },
    },
    onBlur: () => finish(),
  });
  useEffect(() => {
    editor?.commands.focus("end");
  }, [editor]);
  return (
    <EditorContent
      editor={editor}
      className="slide-rich-editor"
      style={{
        fontSize: object.fontSize,
        color: object.color,
        fontFamily: object.fontFamily,
        fontWeight: object.bold ? 700 : 400,
      }}
    />
  );
}
