import { useEffect, useRef, useState, memo } from "react";
import { createUniver } from "./bootstrap";
import {
  ThemeService,
  ICommandService,
  IUndoRedoService,
  IUniverInstanceService,
  IContextService,
  CommandType,
  CellValueType,
  type ICellData,
} from "@univerjs/core";
import {
  UniverSheetsCorePreset,
  SheetsNumfmtCellContentController,
  DISABLE_AUTO_FOCUS_KEY,
} from "@univerjs/preset-sheets-core";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import {
  type Content,
  type Chart,
  type CellDraft,
  validateCellDraft,
  uid,
  cellAddress,
} from "../editor-core/model";
import type { Action, EditorEngine, EditorHost } from "../editor-core/engine";
import type { Translator } from "../i18n";
import type { Language } from "../settings";
import { Button, Icon, IconButton } from "../ui";
import { fromUniver, toUniver } from "./adapter";
import { locales, localeKey } from "./locales";
import { ChartView, type ChartDatum } from "./ChartView";
import { replaceText } from "../editor-core/search";
interface Props {
  content: Extract<Content, { kind: "sheets" }>;
  id: string;
  title: string;
  recoveryDraft?: CellDraft;
  host: EditorHost;
  t: Translator;
  zoom: number;
  language: Language;
  dark: boolean;
  active: boolean;
  decimalSeparator: string;
}
function Sheets({
  content,
  id,
  title,
  recoveryDraft,
  host,
  t,
  zoom,
  language,
  dark,
  active,
  decimalSeparator,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const api = useRef<ReturnType<typeof createUniver> | null>(null);
  const [charts, setCharts] = useState<Chart[]>(content.workbook.charts);
  const chartsRef = useRef(charts);
  const [chartData, setChartData] = useState<Record<string, ChartDatum[]>>({});
  const [chartType, setChartType] = useState<Chart["kind"]>("bar");
  const chartTypeRef = useRef(chartType);
  const [showCharts, setShowCharts] = useState(charts.length > 0);
  chartsRef.current = charts;
  chartTypeRef.current = chartType;
  const initial = useRef({
    content,
    id,
    title,
    host,
    t,
    language,
    recoveryDraft,
  });
  const addChart = useRef<() => Promise<void>>(async () => {});
  const changeCharts = useRef<(next: Chart[]) => void>(() => {});
  useEffect(() => {
    const { content, id, title, host, t, language, recoveryDraft } =
      initial.current;
    if (!container.current) return;
    const worker = new Worker(new URL("./formula.worker.ts", import.meta.url), {
      type: "module",
    });
    const instance = createUniver({
      locale: localeKey[language],
      locales,
      presets: [
        UniverSheetsCorePreset({
          container: container.current,
          header: true,
          toolbar: true,
          ribbonType: "simple",
          formulaBar: true,
          workerURL: worker,
          disableAutoFocus: true,
        }),
        UniverSheetsFilterPreset(),
        UniverSheetsSortPreset(),
        UniverSheetsDataValidationPreset(),
        UniverSheetsConditionalFormattingPreset(),
        UniverSheetsFindReplacePreset(),
      ],
    });
    api.current = instance;
    const book = instance.univerAPI.createWorkbook(
      toUniver(content.workbook, id, title),
    );
    let pendingDraft: CellDraft | undefined;
    const draftChanges = instance.univerAPI.addEvent(
      instance.univerAPI.Event.SheetEditChanging,
      (event) => {
        if (event.workbook.getId() !== id) return;
        pendingDraft = {
          version: 1,
          sheetId: event.worksheet.getSheetId(),
          row: event.row,
          column: event.column,
          text: event.value.toPlainText(),
        };
        host.changed();
      },
    );
    const draftEnd = instance.univerAPI.addEvent(
      instance.univerAPI.Event.SheetEditEnded,
      (event) => {
        if (event.workbook.getId() !== id || !pendingDraft) return;
        pendingDraft = undefined;
        // Escape is not a cell mutation, but must supersede an older recovery
        // draft. Otherwise cancelled input would reappear after a crash.
        host.changed();
      },
    );
    const sheet = () => book.getActiveSheet();
    const range = () => sheet().getActiveRange() ?? sheet().getRange("A1");
    let chartTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshCharts = () => {
      const result: Record<string, ChartDatum[]> = {};
      for (const c of chartsRef.current) {
        const s = book.getSheetBySheetId(c.sheetId);
        if (!s) continue;
        const r = c.range;
        const values = s
          .getRange(
            r.startRow,
            r.startColumn,
            Math.min(151, r.endRow - r.startRow + 1),
            Math.min(2, r.endColumn - r.startColumn + 1),
          )
          .getValues();
        result[c.id] = values
          .filter(
            (row) =>
              row[1] !== null &&
              row[1] !== undefined &&
              String(row[1]).trim() !== "",
          )
          .map((row) => ({
            label: String(row[0] ?? ""),
            value: Number(row[1]),
            x: Number(row[0]),
          }))
          .filter(
            (d) =>
              Number.isFinite(d.value) &&
              (c.kind !== "scatter" || Number.isFinite(d.x)),
          );
      }
      setChartData(result);
    };
    // Nexa chart edits join Univer's history, preserving chronological undo
    // across cell edits, chart creation and chart removal.
    const injector = instance.univer.__getInjector();
    const commands = injector.get(ICommandService);
    const history = injector.get(IUndoRedoService);
    const chartCommand = "nexa.operation.set-charts";
    const chartRegistration = commands.registerCommand({
      id: chartCommand,
      type: CommandType.OPERATION,
      handler: (_accessor, params?: { charts: Chart[] }) => {
        if (!params) return false;
        chartsRef.current = params.charts;
        setCharts(params.charts);
        host.changed();
        refreshCharts();
        return true;
      },
    });
    changeCharts.current = (next) => {
      const previous = chartsRef.current;
      commands.syncExecuteCommand(chartCommand, { charts: next });
      history.pushUndoRedo({
        unitID: id,
        undoMutations: [{ id: chartCommand, params: { charts: previous } }],
        redoMutations: [{ id: chartCommand, params: { charts: next } }],
      });
    };
    const createChart = async () => {
      const raw = await host.prompt("chartRange", range().getA1Notation());
      if (!raw) return;
      const source = sheet().getRange(raw);
      const r = source.getRange();
      if (r.endColumn - r.startColumn < 1 || r.endRow - r.startRow > 10000)
        throw new Error(t("chartEmpty"));
      const name = await host.prompt("chartTitle", t("chart"));
      if (name === null) return;
      const chart: Chart = {
        id: uid(),
        title: name,
        kind: chartTypeRef.current,
        sheetId: sheet().getSheetId(),
        range: {
          startRow: r.startRow,
          endRow: r.endRow,
          startColumn: r.startColumn,
          endColumn: r.endColumn,
        },
      };
      changeCharts.current([...chartsRef.current, chart]);
      setShowCharts(true);
    };
    const action = (
      id: string,
      label: Action["label"],
      fn: () => unknown,
      icon?: string,
    ): Action => ({
      id: `sheet.${id}`,
      label,
      icon: icon ?? label,
      execute: () => {
        fn();
      },
    });
    const actions: Action[] = [
      {
        id: "sheet.cancelInput",
        label: "cancelCellInput",
        icon: "close",
        shortcut: "Escape",
        available: () => book.isCellEditing(),
        execute: async () => {
          await book.abortEditingAsync();
        },
      },
      action("bold", "bold", () => range().setFontWeight("bold")),
      action("italic", "italic", () => range().setFontStyle("italic")),
      action("underline", "underline", () => range().setFontLine("underline")),
      action("merge", "merge", () => range().merge(), "sheets"),
      action("unmerge", "unmerge", () => range().breakApart(), "grid"),
      action(
        "currency",
        "currency",
        () => range().setNumberFormat('"€"#,##0.00'),
        "sheets",
      ),
      action(
        "percent",
        "percent",
        () => range().setNumberFormat("0.00%"),
        "sheets",
      ),
      action(
        "decimals",
        "decimals",
        () => range().setNumberFormat("0.00"),
        "sheets",
      ),
      action(
        "freeze",
        "freeze",
        () =>
          sheet().setFreeze({
            startRow: 1,
            startColumn: -1,
            ySplit: 1,
            xSplit: 0,
          }),
        "row",
      ),
      action("unfreeze", "unfreeze", () => sheet().cancelFreeze(), "row"),
      action(
        "insertRows",
        "insertRows",
        () => sheet().insertRows(range().getRow(), range().getHeight()),
        "row",
      ),
      action(
        "insertColumns",
        "insertColumns",
        () => sheet().insertColumns(range().getColumn(), range().getWidth()),
        "column",
      ),
      action(
        "deleteRows",
        "deleteRows",
        () => sheet().deleteRows(range().getRow(), range().getHeight()),
        "delete",
      ),
      action(
        "deleteColumns",
        "deleteColumns",
        () => sheet().deleteColumns(range().getColumn(), range().getWidth()),
        "delete",
      ),
      action("clear", "clear", () => range().clearContent(), "delete"),
      action(
        "clearFormat",
        "clearFormat",
        () => range().clearFormat(),
        "delete",
      ),
      {
        id: "sheet.newSheet",
        label: "newSheet",
        icon: "plus",
        execute: async () => {
          const name = await host.prompt(
            "name",
            `${t("sheets")} ${book.getSheets().length + 1}`,
          );
          if (name) book.insertSheet(name);
        },
      },
      {
        id: "sheet.chart",
        label: "chart",
        icon: "chart",
        execute: createChart,
      },
    ];
    let cellCount: string | undefined;
    const engine: EditorEngine = {
      kind: "sheets",
      prepareSnapshot: async () => {
        if (book.isCellEditing() && !(await book.endEditingAsync(true)))
          throw new Error(t("cellEditIncomplete"));
      },
      actions,
      snapshot: () => ({
        kind: "sheets",
        workbook: fromUniver(book.save(), chartsRef.current),
      }),
      recoveryDraft: () => pendingDraft,
      printSnapshot: () => {
        const selectedSheet = sheet();
        const source = selectedSheet.getSheet().getSnapshot();
        let { startRow, endRow, startColumn, endColumn } = range().getRange();
        // A multi-cell selection is an explicit print area. A single cell
        // prints the used area of the active sheet, not an unrelated first tab.
        if (startRow === endRow && startColumn === endColumn) {
          startRow = 0;
          startColumn = 0;
          endRow = 0;
          endColumn = 0;
          for (const [r, row] of Object.entries(source.cellData ?? {})) {
            endRow = Math.max(endRow, Number(r));
            for (const c of Object.keys(row))
              endColumn = Math.max(endColumn, Number(c));
          }
        }
        const rows = endRow - startRow + 1;
        const columns = endColumn - startColumn + 1;
        if (rows > 200 || columns > 50 || rows * columns > 10000)
          throw new Error(t("printLimit"));
        const data: Record<number, Record<number, ICellData>> = {};
        for (let r = 0; r < rows; r++) {
          const row: Record<number, ICellData> = {};
          for (let c = 0; c < columns; c++) {
            const cell = source.cellData?.[r + startRow]?.[c + startColumn];
            if (cell) row[c] = cell;
          }
          data[r] = row;
        }
        const workbook = fromUniver(
          {
            ...book.getWorkbook().getSnapshot(),
            sheetOrder: [selectedSheet.getSheetId()],
            sheets: {
              [selectedSheet.getSheetId()]: { ...source, cellData: data },
            },
          },
          [],
        );
        const displayed = selectedSheet
          .getRange(startRow, startColumn, rows, columns)
          .getDisplayValues();
        const target = workbook.sheets[0];
        if (!target) throw new Error("No active worksheet to print");
        for (let r = 0; r < rows; r++) {
          const row = (target.cells[r] ??= {});
          for (let c = 0; c < columns; c++)
            row[c] = { ...row[c], value: displayed[r]?.[c] ?? "" };
        }
        return { kind: "sheets", workbook };
      },
      undo: () => {
        injector.get(IUniverInstanceService).focusUnit(id);
        return instance.univerAPI.undo();
      },
      redo: () => {
        injector.get(IUniverInstanceService).focusUnit(id);
        return instance.univerAPI.redo();
      },
      focus: () => {
        container.current?.querySelector("canvas")?.focus();
      },
      setZoom: (value) => {
        void instance.univerAPI.executeCommand("sheet.command.set-zoom-ratio", {
          unitId: id,
          subUnitId: sheet().getSheetId(),
          zoomRatio: value / 100,
        });
      },
      getText: () =>
        (cellCount ??= String(
          book
            .getSheets()
            .reduce(
              (count, s) =>
                count +
                Object.values(s.getSheet().getSnapshot().cellData ?? {}).reduce(
                  (n, r) => n + Object.keys(r).length,
                  0,
                ),
              0,
            ),
        )),
      find: async (query, replace) => {
        if (!query) return 0;
        let count = 0;
        let first = true;
        for (const s of book.getSheets()) {
          const data = s.getSheet().getSnapshot().cellData ?? {};
          const updates: Record<number, Record<number, { v: string }>> = {};
          let rows = 0;
          for (const [r, row] of Object.entries(data)) {
            for (const [c, cell] of Object.entries(
              row as Record<string, ICellData | null>,
            )) {
              if (
                !cell ||
                !String(cell.v ?? "")
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase())
              )
                continue;
              count++;
              if (replace !== undefined && !cell.f)
                (updates[Number(r)] ??= {})[Number(c)] = {
                  v: replaceText(String(cell.v ?? ""), query, replace),
                };
              else if (first) {
                book.setActiveSheet(s);
                s.setActiveRange(s.getRange(cellAddress(Number(r), Number(c))));
                first = false;
              }
            }
            if (++rows % 500 === 0)
              await new Promise((resolve) => setTimeout(resolve, 0));
          }
          if (Object.keys(updates).length)
            s.getRange(0, 0, s.getMaxRows(), s.getMaxColumns()).setValues(
              updates,
            );
        }
        return count;
      },
      dispose: () => {},
    };
    const change = book.onCommandExecuted((command) => {
      if (
        command.id.includes(".mutation.") &&
        !command.id.includes("formula-calculation")
      ) {
        cellCount = undefined;
        host.changed();
      }
      host.selectionChanged();
      if (chartsRef.current.length) {
        clearTimeout(chartTimer);
        chartTimer = setTimeout(refreshCharts, 300);
      }
    });
    if (recoveryDraft) {
      const draft = validateCellDraft(recoveryDraft, content);
      const target = book.getSheetBySheetId(draft.sheetId);
      if (!target) throw new Error(t("cellEditIncomplete"));
      book.setActiveSheet(target);
      const location = target.getRange(draft.row, draft.column);
      target.setActiveRange(location);
      // A draft may be an incomplete formula. Preserve it literally, with a
      // normal undo transaction back to the previously committed cell.
      const restored = commands.syncExecuteCommand(
        "sheet.command.set-range-values",
        {
          unitId: id,
          subUnitId: draft.sheetId,
          range: location.getRange(),
          value: { v: draft.text, t: CellValueType.STRING, f: null, p: null },
        },
      );
      if (!restored) throw new Error(t("cellEditIncomplete"));
    }
    host.ready(engine);
    addChart.current = createChart;
    chartTimer = setTimeout(refreshCharts, 100);
    return () => {
      clearTimeout(chartTimer);
      change.dispose();
      draftChanges.dispose();
      draftEnd.dispose();
      chartRegistration.dispose();
      // Univer owns a separate React root; unmount it after our commit.
      queueMicrotask(() => instance.univer.dispose());
      worker.terminate();
      api.current = null;
    };
  }, []);
  useEffect(() => {
    const shortcut = api.current?.univerAPI.getShortcut();
    const units = api.current?.univer
      .__getInjector()
      .get(IUniverInstanceService);
    api.current?.univer
      .__getInjector()
      .get(IContextService)
      .setContextValue(DISABLE_AUTO_FOCUS_KEY, !active);
    // Shortcut suspension alone does not suspend the canvas editor's delayed
    // focus requests. Release its focused unit while outside this document.
    units?.focusUnit(active ? id : null);
    if (active) shortcut?.enableShortcut();
    else shortcut?.disableShortcut();
    return () => {
      units?.focusUnit(null);
      shortcut?.disableShortcut();
    };
  }, [active, id]);
  useEffect(() => {
    api.current?.univerAPI.setLocale(localeKey[language]);
  }, [language]);
  useEffect(() => {
    api.current?.univer
      .__getInjector()
      .get(SheetsNumfmtCellContentController)
      .setNumfmtLocal(decimalSeparator === "," ? "es" : "en");
  }, [decimalSeparator]);
  useEffect(() => {
    api.current?.univer.__getInjector().get(ThemeService).setDarkMode(dark);
  }, [dark]);
  useEffect(() => {
    const book = api.current?.univerAPI.getActiveWorkbook();
    if (book)
      void api.current?.univerAPI.executeCommand(
        "sheet.command.set-zoom-ratio",
        {
          unitId: id,
          subUnitId: book.getActiveSheet().getSheetId(),
          zoomRatio: zoom / 100,
        },
      );
  }, [zoom, id]);
  return (
    <div className="sheets-layout">
      <div
        ref={container}
        className="univer-container"
        data-testid="spreadsheet-canvas"
      />
      <div className="chart-strip">
        <Button
          onClick={() => setShowCharts((s) => !s)}
          aria-pressed={showCharts}
        >
          <Icon name="chart" />
          {t("charts")}
          {charts.length ? ` · ${charts.length}` : ""}
        </Button>
        <span>{t("chartHint")}</span>
      </div>
      {showCharts && (
        <div className="charts-panel">
          <div className="chart-options">
            <select
              aria-label={t("chart")}
              value={chartType}
              onChange={(e) => setChartType(e.target.value as Chart["kind"])}
            >
              {(["bar", "line", "pie", "scatter"] as const).map((k) => (
                <option value={k} key={k}>
                  {t(k)}
                </option>
              ))}
            </select>
            <Button
              onClick={() => {
                void addChart.current().catch(host.error);
              }}
            >
              <Icon name="plus" />
              {t("chart")}
            </Button>
            {!charts.length && <p>{t("chartEmpty")}</p>}
          </div>
          <div className="chart-list">
            {charts.map((chart) => (
              <article key={chart.id}>
                <IconButton
                  label={t("delete")}
                  icon="close"
                  onClick={() => {
                    changeCharts.current(
                      chartsRef.current.filter((c) => c.id !== chart.id),
                    );
                  }}
                />
                <ChartView chart={chart} data={chartData[chart.id] ?? []} />
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
export default memo(Sheets);
