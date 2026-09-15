import { Extension, Node, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "inline",
  inline: true,
  atom: true,
  parseHTML: () => [{ tag: "span[data-page-break]" }],
  renderHTML: () => [
    "span",
    { "data-page-break": "", class: "page-break", contenteditable: "false" },
  ],
});
export const ParagraphLayout = Extension.create({
  name: "paragraphLayout",
  addGlobalAttributes: () => [
    {
      types: ["paragraph", "heading"],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (element) =>
            parseFloat(element.style.marginLeft) / 36 || 0,
          renderHTML: (attrs) => ({
            style: `margin-left:${Number(attrs.indent) * 36}px`,
          }),
        },
        lineHeight: {
          default: 1.6,
          parseHTML: (element) => parseFloat(element.style.lineHeight) || 1.6,
          renderHTML: (attrs) => ({
            style: `line-height:${Number(attrs.lineHeight)}`,
          }),
        },
        spaceAfter: {
          default: 10,
          parseHTML: (element) => parseFloat(element.style.marginBottom) || 10,
          renderHTML: (attrs) => ({
            style: `margin-bottom:${Number(attrs.spaceAfter)}px`,
          }),
        },
      },
    },
  ],
});
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: 400 },
      height: { default: null },
      align: { default: "left" },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(HTMLAttributes, {
        style: `max-width:100%;height:auto;width:${Number(HTMLAttributes.width)}px;float:${HTMLAttributes.align === "wrap" ? "left" : "none"};display:${HTMLAttributes.align === "center" ? "block" : "inline-block"};margin:${HTMLAttributes.align === "center" ? "12px auto" : "8px 12px 8px 0"}`,
      }),
    ];
  },
}).configure({ inline: true, allowBase64: true });
