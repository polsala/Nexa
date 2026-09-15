import {
  BooleanNumber,
  CellValueType,
  HorizontalAlign,
  LocaleType,
  WrapStrategy,
  type ICellData,
  type IStyleData,
  type IWorkbookData,
  type IWorksheetData,
  type IDocumentData,
} from "@univerjs/core";
import {
  type Workbook,
  type CellFormat,
  type Cell,
  type Properties,
  type Worksheet,
} from "../editor-core/model";
export function toStyle(format: CellFormat = {}): IStyleData {
  const extension = (format.univerStyle ?? {}) as IStyleData;
  return {
    ...extension,
    ...(format.fontFamily ? { ff: format.fontFamily } : {}),
    ...(format.fontSize ? { fs: format.fontSize } : {}),
    ...(format.bold !== undefined ? { bl: format.bold ? 1 : 0 } : {}),
    ...(format.italic !== undefined ? { it: format.italic ? 1 : 0 } : {}),
    ...(format.underline !== undefined
      ? { ul: { s: format.underline ? 1 : 0 } }
      : {}),
    ...(format.color ? { cl: { rgb: format.color } } : {}),
    ...(format.background ? { bg: { rgb: format.background } } : {}),
    ...(format.numberFormat ? { n: { pattern: format.numberFormat } } : {}),
    ...(format.align
      ? {
          ht: (
            {
              left: HorizontalAlign.LEFT,
              center: HorizontalAlign.CENTER,
              right: HorizontalAlign.RIGHT,
            } as Record<string, HorizontalAlign>
          )[format.align],
        }
      : {}),
    ...(format.wrap !== undefined
      ? { tb: format.wrap ? WrapStrategy.WRAP : WrapStrategy.OVERFLOW }
      : {}),
  };
}
export function fromStyle(
  style: IStyleData | null | undefined | void,
): CellFormat {
  if (!style) return {};
  return {
    univerStyle: style,
    ...(style.ff ? { fontFamily: style.ff } : {}),
    ...(style.fs ? { fontSize: style.fs } : {}),
    ...(style.bl !== undefined ? { bold: style.bl === 1 } : {}),
    ...(style.it !== undefined ? { italic: style.it === 1 } : {}),
    ...(style.ul ? { underline: style.ul.s === 1 } : {}),
    ...(style.cl?.rgb ? { color: style.cl.rgb } : {}),
    ...(style.bg?.rgb ? { background: style.bg.rgb } : {}),
    ...(style.n ? { numberFormat: style.n.pattern } : {}),
    ...(style.ht
      ? {
          align: (
            { 1: "left", 2: "center", 3: "right" } as Record<number, string>
          )[style.ht],
        }
      : {}),
    ...(style.tb ? { wrap: style.tb === WrapStrategy.WRAP } : {}),
  };
}
export function toUniver(
  book: Workbook,
  id: string,
  title: string,
): IWorkbookData {
  const sheets: Record<string, Partial<IWorksheetData>> = {};
  for (const sheet of book.sheets) {
    const data: Record<number, Record<number, ICellData>> = {};
    for (const [r, row] of Object.entries(sheet.cells)) {
      const cells: Record<number, ICellData> = {};
      for (const [c, cell] of Object.entries(row))
        cells[Number(c)] = {
          ...(cell.extensions?.univerCell as ICellData | undefined),
          v: cell.value,
          f: cell.formula,
          ...(cell.format && Object.keys(cell.format).length
            ? { s: toStyle(cell.format) }
            : {}),
          t:
            typeof cell.value === "number"
              ? CellValueType.NUMBER
              : typeof cell.value === "boolean"
                ? CellValueType.BOOLEAN
                : CellValueType.STRING,
          ...(cell.richText ? { p: cell.richText as IDocumentData } : {}),
        };
      data[Number(r)] = cells;
    }
    sheets[sheet.id] = {
      ...(sheet.extensions.univerSheet as Partial<IWorksheetData> | undefined),
      id: sheet.id,
      name: sheet.name,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      cellData: data,
      mergeData: sheet.merges,
      freeze: {
        startRow: sheet.freeze[0] ? sheet.freeze[0] : -1,
        startColumn: sheet.freeze[1] ? sheet.freeze[1] : -1,
        ySplit: sheet.freeze[0],
        xSplit: sheet.freeze[1],
      },
      rowData: sheet.rowDimensions,
      columnData: sheet.columnDimensions,
      defaultColumnWidth: 100,
      defaultRowHeight: 26,
      showGridlines: BooleanNumber.TRUE,
      rowHeader: { width: 46 },
      columnHeader: { height: 28 },
    };
  }
  return {
    id,
    name: title,
    appVersion: "0.25.1",
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: book.sheets.map((s) => s.id),
    sheets,
    resources: book.extensions.univerResources as IWorkbookData["resources"],
    defaultStyle: book.extensions
      .univerDefaultStyle as IWorkbookData["defaultStyle"],
  };
}
export function fromUniver(
  data: IWorkbookData,
  charts: Workbook["charts"],
): Workbook {
  const sheets: Worksheet[] = [];
  for (const id of data.sheetOrder) {
    const s = data.sheets[id];
    if (!s) continue;
    const cells: Record<number, Record<number, Cell>> = {};
    for (const [r, row] of Object.entries(s.cellData ?? {})) {
      const target: Record<number, Cell> = {};
      for (const [c, cell] of Object.entries(
        row as Record<string, ICellData | null>,
      )) {
        if (!cell) continue;
        const { v, f, s: style, p, ...extra } = cell;
        target[Number(c)] = {
          value:
            extra.t === CellValueType.BOOLEAN
              ? v === true || v === 1
              : (v ?? null),
          ...(f ? { formula: f } : {}),
          format: fromStyle(
            typeof style === "string" ? data.styles[style] : style,
          ),
          ...(p ? { richText: p } : {}),
          extensions: {
            univerCell: extra,
            ...(typeof v === "string" &&
            /^#(REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|NULL!)/.test(v)
              ? { error: true }
              : {}),
          },
        };
      }
      cells[Number(r)] = target;
    }
    const {
      rowData: rows,
      columnData: cols,
      mergeData: merges,
      freeze,
      ...extension
    } = s;
    delete extension.cellData;
    sheets.push({
      id,
      name: s.name ?? id,
      rowCount: s.rowCount ?? 1000,
      columnCount: s.columnCount ?? 26,
      cells,
      merges: merges ?? [],
      freeze: [freeze?.ySplit ?? 0, freeze?.xSplit ?? 0],
      rowDimensions: (rows as Record<number, Properties>) ?? {},
      columnDimensions: (cols as Record<number, Properties>) ?? {},
      extensions: { univerSheet: extension },
    });
  }
  return {
    sheets,
    charts,
    extensions: {
      univerResources: data.resources ?? [],
      univerDefaultStyle: data.defaultStyle ?? null,
      univerVersion: "0.25.1",
    },
  };
}
