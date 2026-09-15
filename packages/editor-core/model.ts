export type Kind = "writer" | "sheets" | "slides";
export type Properties = Record<string, unknown>;
export interface TextNode {
  type: string;
  text?: string;
  attrs?: Properties;
  marks?: { type: string; attrs?: Properties }[];
  content?: TextNode[];
}
export interface Page {
  width: number;
  height: number;
  margins: [number, number, number, number];
  header: string;
  footer: string;
}
export interface CellFormat extends Properties {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  background?: string;
  numberFormat?: string;
  align?: string;
  wrap?: boolean;
}
export interface Cell {
  value: string | number | boolean | null;
  formula?: string;
  format?: CellFormat;
  richText?: unknown;
  extensions?: Properties;
}
export interface CellRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}
export interface Worksheet {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  cells: Record<number, Record<number, Cell>>;
  merges: CellRange[];
  freeze: [number, number];
  rowDimensions: Record<number, Properties>;
  columnDimensions: Record<number, Properties>;
  extensions: Properties;
}
export interface Chart {
  id: string;
  kind: "bar" | "line" | "pie" | "scatter";
  title: string;
  sheetId: string;
  range: CellRange;
}
export interface Workbook {
  sheets: Worksheet[];
  charts: Chart[];
  extensions: Properties;
}
export interface SlideObject {
  id: string;
  kind: "text" | "rectangle" | "ellipse" | "line" | "arrow" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
  align: string;
  src?: string;
  richText?: TextNode;
}
export interface Slide {
  id: string;
  name: string;
  background: string;
  notes: string;
  objects: SlideObject[];
}
export interface Deck {
  width: number;
  height: number;
  slides: Slide[];
}
export type Content =
  | { kind: "writer"; body: TextNode; page: Page }
  | { kind: "sheets"; workbook: Workbook }
  | { kind: "slides"; deck: Deck };
/** Recovery-only input; the committed cell remains unchanged in content. */
export interface CellDraft {
  version: 1;
  sheetId: string;
  row: number;
  column: number;
  text: string;
}
export interface NexaDocument {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: number;
  modifiedAt: number;
  revision: number;
  content: Content;
  metadata: Properties;
  recoveryDraft?: CellDraft;
  [key: string]: unknown;
}
export const uid = () => crypto.randomUUID();
export const paragraph = (text = "", type = "paragraph"): TextNode => ({
  type,
  ...(type === "heading" ? { attrs: { level: 1 } } : {}),
  content: text ? [{ type: "text", text }] : [],
});
export const blankSheet = (name: string): Worksheet => ({
  id: uid(),
  name,
  rowCount: 1000,
  columnCount: 26,
  cells: {},
  merges: [],
  freeze: [0, 0],
  rowDimensions: {},
  columnDimensions: {},
  extensions: {},
});
export const object = (kind: SlideObject["kind"], text = ""): SlideObject => ({
  id: uid(),
  kind,
  x: 100,
  y: 120,
  width: kind === "text" ? 720 : 260,
  height: kind === "text" ? 130 : 180,
  rotation: 0,
  fill: kind === "text" ? "transparent" : "#dce9de",
  stroke: "transparent",
  strokeWidth: 1,
  text,
  fontSize: 40,
  fontFamily: "Arial",
  color: "#183d33",
  bold: false,
  italic: false,
  align: "left",
});
export const blankSlide = (name: string): Slide => ({
  id: uid(),
  name,
  background: "#ffffff",
  notes: "",
  objects: [],
});
export function newDocument(kind: Kind, title: string): NexaDocument {
  const content: Content =
    kind === "writer"
      ? {
          kind,
          body: { type: "doc", content: [paragraph()] },
          page: {
            width: 794,
            height: 1123,
            margins: [76, 76, 76, 76],
            header: "",
            footer: "",
          },
        }
      : kind === "sheets"
        ? {
            kind,
            workbook: {
              sheets: [blankSheet("Sheet 1")],
              charts: [],
              extensions: {},
            },
          }
        : {
            kind,
            deck: { width: 1280, height: 720, slides: [blankSlide("Slide 1")] },
          };
  return {
    schemaVersion: 1,
    id: uid(),
    title,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    revision: 0,
    content,
    metadata: {},
  };
}
export function plainText(node: TextNode): string {
  return (
    node.text ??
    node.content
      ?.map(plainText)
      .join(
        ["doc", "table", "bulletList", "orderedList"].includes(node.type)
          ? "\n"
          : node.type === "tableRow"
            ? "\t"
            : "",
      ) ??
    ""
  );
}
export function isRecord(v: unknown): v is Properties {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
export function parseDocument(v: unknown): NexaDocument {
  if (
    !isRecord(v) ||
    v.schemaVersion !== 1 ||
    typeof v.id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(v.id) ||
    typeof v.title !== "string" ||
    !isRecord(v.content) ||
    !["writer", "sheets", "slides"].includes(String(v.content.kind))
  )
    throw new Error("Invalid or unsupported Nexa document");
  if (
    v.content.kind === "writer" &&
    (!isRecord(v.content.body) || !isRecord(v.content.page))
  )
    throw new Error("Invalid Writer document");
  if (
    v.content.kind === "sheets" &&
    (!isRecord(v.content.workbook) ||
      !Array.isArray(v.content.workbook.sheets) ||
      v.content.workbook.sheets.length === 0)
  )
    throw new Error("Invalid workbook");
  if (
    v.content.kind === "slides" &&
    (!isRecord(v.content.deck) ||
      !Array.isArray(v.content.deck.slides) ||
      v.content.deck.slides.length === 0)
  )
    throw new Error("Invalid presentation");
  const document = v as unknown as NexaDocument;
  if (v.recoveryDraft !== undefined)
    validateCellDraft(v.recoveryDraft, document.content);
  return document;
}
export function validateCellDraft(value: unknown, content: Content): CellDraft {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.sheetId !== "string" ||
    typeof value.row !== "number" ||
    !Number.isInteger(value.row) ||
    value.row < 0 ||
    typeof value.column !== "number" ||
    !Number.isInteger(value.column) ||
    value.column < 0 ||
    typeof value.text !== "string" ||
    value.text.length > 1024 * 1024 ||
    new TextEncoder().encode(value.text).length > 1024 * 1024 ||
    content.kind !== "sheets" ||
    !content.workbook.sheets.some(
      (s) =>
        s.id === value.sheetId &&
        (value.row as number) < s.rowCount &&
        (value.column as number) < s.columnCount,
    )
  )
    throw new Error("Invalid or oversized recovery cell input");
  return value as unknown as CellDraft;
}
export function cellAddress(row: number, column: number): string {
  let n = column + 1;
  let a = "";
  while (n) {
    n--;
    a = String.fromCharCode(65 + (n % 26)) + a;
    n = Math.floor(n / 26);
  }
  return a + (row + 1);
}
export function worksheetBounds(sheet: Worksheet): {
  rows: number;
  columns: number;
} {
  let rows = 0,
    columns = 0;
  for (const [row, cells] of Object.entries(sheet.cells)) {
    rows = Math.max(rows, Number(row) + 1);
    for (const column of Object.keys(cells))
      columns = Math.max(columns, Number(column) + 1);
  }
  return { rows, columns };
}
