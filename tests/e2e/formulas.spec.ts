import { test, expect } from "@playwright/test";
test("formula worker calculates all required function families after TSV paste", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.locator(".create-card.sheets").click();
  const canvas = page.locator('canvas[id^="univer-sheet-main-canvas_"]');
  await expect(canvas).toBeVisible();
  const cases: [string, string | number | boolean][] = [
    ["=SUM(A1:A3)", 60],
    ['=SUMIF(A1:A3,">15")', 50],
    ['=SUMIFS(A1:A3,A1:A3,">10",A1:A3,"<30")', 20],
    ["=ROUND(1.235,2)", 1.24],
    ["=ABS(-9)", 9],
    ["=MIN(A1:A3)", 10],
    ["=MAX(A1:A3)", 30],
    ['=IF(A1=10,"yes","no")', "yes"],
    ['=IFS(A1=10,"ten",TRUE,"other")', "ten"],
    ["=AND(TRUE,TRUE)", true],
    ["=OR(FALSE,TRUE)", true],
    ["=NOT(TRUE)", false],
    ["=IFERROR(1/0,42)", 42],
    ["=XLOOKUP(20,A1:A3,A1:A3)", 20],
    ["=VLOOKUP(20,A1:A3,1,FALSE)", 20],
    ["=HLOOKUP(10,A1:B1,1,FALSE)", 10],
    ["=INDEX(A1:A3,2)", 20],
    ["=MATCH(20,A1:A3,0)", 2],
    ['=CONCAT("a","b")', "ab"],
    ['=TEXTJOIN("-",TRUE,"a","b")', "a-b"],
    ['=LEFT("abc",2)', "ab"],
    ['=RIGHT("abc",2)', "bc"],
    ['=MID("abc",2,1)', "b"],
    ['=LEN("abc")', 3],
    ['=TRIM("  hello  ")', "hello"],
    ["=YEAR(DATE(2026,9,14))", 2026],
    ["=MONTH(DATE(2026,9,14))", 9],
    ["=DAY(DATE(2026,9,14))", 14],
    ["=COUNT(A1:A3)", 3],
    ["=COUNTA(A1:A3)", 3],
    ['=COUNTIF(A1:A3,">10")', 2],
    ["=AVERAGE(A1:A3)", 20],
    ["=MEDIAN(A1:A3)", 20],
    ["=TODAY()>45000", true],
    ["=NOW()>=TODAY()", true],
  ];
  const tsv = cases
    .map(([formula], i) => `${i < 3 ? (i + 1) * 10 : ""}\t${formula}`)
    .join("\n");
  await page.evaluate((value) => navigator.clipboard.writeText(value), tsv);
  await canvas.click({ position: { x: 93, y: 40 } });
  await page.keyboard.press("Control+v");
  const values = () =>
    page.evaluate(async () => {
      const path = "/packages/shell/workspace.ts";
      const { workspace } = (await import(
        path
      )) as typeof import("../../packages/shell/workspace");
      const c = workspace.active()?.engine?.snapshot();
      return c?.kind === "sheets" ? c.workbook.sheets[0]?.cells : undefined;
    });
  await expect
    .poll(
      async () => {
        const cells = await values();
        return cases.map((_, i) => cells?.[i]?.[1]?.value);
      },
      { timeout: 25000 },
    )
    .toEqual(cases.map(([, expected]) => expected));
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  await (await download).saveAs("artifacts/qa/formulas.nxs");
  await expect(page.locator(".save-status")).toContainText("All changes saved");
  await page
    .getByRole("button", { name: "Close Untitled 1", exact: true })
    .click();
  await page.locator(".recent-row").filter({ hasText: "Untitled 1" }).click();
  await expect
    .poll(async () => {
      const cells = await values();
      return cases.map((_, i) => cells?.[i]?.[1]?.value);
    })
    .toEqual(cases.map(([, expected]) => expected));
});
