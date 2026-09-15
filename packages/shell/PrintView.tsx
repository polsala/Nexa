import type { CSSProperties } from "react";
import {
  worksheetBounds,
  type NexaDocument,
  type TextNode,
} from "../editor-core/model";
import { SlideCanvas } from "../slides/SlideCanvas";
function Text({ node }: { node: TextNode }) {
  if (node.text !== undefined) {
    let style: CSSProperties = {};
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") style.fontWeight = 700;
      if (mark.type === "italic") style.fontStyle = "italic";
      if (mark.type === "underline") style.textDecoration = "underline";
      if (mark.type === "strike") style.textDecoration = "line-through";
      if (mark.type === "highlight")
        style.backgroundColor = String(mark.attrs?.color ?? "#fff1a6");
      if (mark.type === "superscript" || mark.type === "subscript") {
        style.verticalAlign = mark.type === "superscript" ? "super" : "sub";
        style.fontSize = "0.75em";
      }
      if (mark.type === "textStyle")
        style = {
          ...style,
          color: String(mark.attrs?.color ?? "inherit"),
          fontSize: String(mark.attrs?.fontSize ?? "inherit"),
          fontFamily: String(mark.attrs?.fontFamily ?? "inherit"),
        };
    }
    return <span style={style}>{node.text}</span>;
  }
  const content = node.content?.map((n, i) => <Text node={n} key={i} />);
  const style: CSSProperties = {
    textAlign: node.attrs?.textAlign as CSSProperties["textAlign"],
    lineHeight: Number(node.attrs?.lineHeight ?? 1.6),
    marginBottom: Number(node.attrs?.spaceAfter ?? 10),
    marginLeft: Number(node.attrs?.indent ?? 0) * 36,
  };
  switch (node.type) {
    case "doc":
      return <>{content}</>;
    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      const Heading = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Heading style={style}>{content}</Heading>;
    }
    case "paragraph":
      return <p style={style}>{content ?? <br />}</p>;
    case "table":
      return (
        <table>
          <tbody>{content}</tbody>
        </table>
      );
    case "tableRow":
      return <tr>{content}</tr>;
    case "tableCell":
      return (
        <td
          colSpan={Number(node.attrs?.colspan ?? 1)}
          rowSpan={Number(node.attrs?.rowspan ?? 1)}
        >
          {content}
        </td>
      );
    case "tableHeader":
      return <th colSpan={Number(node.attrs?.colspan ?? 1)}>{content}</th>;
    case "image":
      return (
        <img
          src={String(node.attrs?.src ?? "")}
          alt={String(node.attrs?.alt ?? "")}
          style={{ maxWidth: "100%", width: Number(node.attrs?.width ?? 400) }}
        />
      );
    case "bulletList":
      return <ul>{content}</ul>;
    case "orderedList":
      return <ol start={Number(node.attrs?.start ?? 1)}>{content}</ol>;
    case "listItem":
      return <li>{content}</li>;
    case "hardBreak":
      return <br />;
    case "pageBreak":
      return <span style={{ display: "block", breakAfter: "page" }} />;
    case "horizontalRule":
      return <hr />;
    default:
      return <div>{content}</div>;
  }
}
export function PrintView({ document: doc }: { document: NexaDocument }) {
  const c = doc.content;
  if (c.kind === "writer")
    return (
      <div id="print-root">
        <style>{`@media print { @page { size: ${c.page.width}px ${c.page.height}px; margin: ${c.page.margins.map((v) => `${v}px`).join(" ")}; } }`}</style>
        {c.page.header && <header>{c.page.header}</header>}
        <Text node={c.body} />
        {c.page.footer && <footer>{c.page.footer}</footer>}
      </div>
    );
  if (c.kind === "slides")
    return (
      <div id="print-root">
        <style>{`@media print { @page { size: ${c.deck.width}px ${c.deck.height}px; margin: 0; } }`}</style>
        {c.deck.slides.map((s) => (
          <div className="print-slide" key={s.id}>
            <SlideCanvas
              slide={s}
              width={c.deck.width}
              height={c.deck.height}
            />
          </div>
        ))}
      </div>
    );
  const sheet = c.workbook.sheets[0];
  if (!sheet) return null;
  const { rows, columns } = worksheetBounds(sheet);
  return (
    <div id="print-root">
      <style>
        {"@media print { @page { size: A4 landscape; margin: 12mm; } }"}
      </style>
      <h2>
        {doc.title} · {sheet.name}
      </h2>
      <table>
        <tbody>
          {Array.from({ length: Math.min(200, Math.max(1, rows)) }, (_, r) => (
            <tr key={r}>
              {Array.from(
                { length: Math.min(50, Math.max(1, columns)) },
                (_, col) => {
                  const cell = sheet.cells[r]?.[col];
                  return (
                    <td
                      key={col}
                      style={{
                        fontWeight: cell?.format?.bold ? 700 : 400,
                        background: cell?.format?.background,
                        color: cell?.format?.color,
                      }}
                    >
                      {String(cell?.value ?? "")}
                    </td>
                  );
                },
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function stats(doc: NexaDocument, text: string): number {
  return doc.content.kind === "writer"
    ? text.trim().split(/\s+/).filter(Boolean).length
    : text
      ? Number(text)
      : doc.content.kind === "slides"
        ? doc.content.deck.slides.length
        : Object.values(doc.content.workbook.sheets[0]?.cells ?? {}).reduce(
            (n, r) => n + Object.keys(r).length,
            0,
          );
}
