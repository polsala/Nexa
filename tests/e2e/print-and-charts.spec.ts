import { test, expect, type Page } from "@playwright/test";
async function command(page: Page, id: string) {
  await page.keyboard.press("Control+k");
  const input = page.getByRole("dialog").getByRole("combobox");
  await input.fill(id);
  await expect(page.getByRole("dialog").getByRole("option")).toHaveCount(1);
  await input.press("Enter");
}
test("charts reference worksheet data and share chronological undo history", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.locator(".create-card.sheets").click();
  const canvas = page.locator('canvas[id^="univer-sheet-main-canvas_"]');
  await canvas.click({ position: { x: 93, y: 40 } });
  await page.evaluate(() =>
    navigator.clipboard.writeText("Jan\t10\nFeb\t-5\nMar\t15"),
  );
  await page.keyboard.press("Control+v");
  await command(page, "sheet.chart");
  await page
    .getByRole("textbox", {
      name: "Data range (for example A1:B6)",
      exact: true,
    })
    .fill("A1:B3");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Chart title", exact: true })
    .fill("Local revenue");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const chart = page.getByRole("img", { name: "Local revenue", exact: true });
  await expect(chart).toBeVisible();
  await expect(chart.locator("rect title")).toHaveText([
    "Jan: 10",
    "Feb: -5",
    "Mar: 15",
  ]);
  await command(page, "edit.undo");
  await expect(chart).toHaveCount(0);
  await command(page, "edit.redo");
  await expect(chart).toBeVisible();
  await page
    .locator(".chart-list article")
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await expect(chart).toHaveCount(0);
  await command(page, "edit.undo");
  await expect(chart).toBeVisible();
});
test("local print pipeline renders Writer and one page per slide to PDF", async ({
  page,
}) => {
  // Capture the prepared print tree without launching a platform-owned dialog.
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto("/");
  await page.locator(".create-card.writer").click();
  await page
    .getByRole("textbox", { name: "Document", exact: true })
    .fill("Printable local text");
  await command(page, "file.print");
  await expect(page.locator("#print-root")).toContainText(
    "Printable local text",
  );
  const writer = await page.pdf({
    path: "artifacts/qa/writer-print.pdf",
    preferCSSPageSize: true,
  });
  expect(writer.subarray(0, 5).toString()).toBe("%PDF-");
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator("#print-root")).toHaveCount(0);
  await page.locator(".wordmark").click();
  await page.locator(".create-card.slides").click();
  await command(page, "slides.addSlide");
  await command(page, "file.print");
  await expect(page.locator("#print-root .print-slide")).toHaveCount(2);
  const deck = await page.pdf({
    path: "artifacts/qa/slides-print.pdf",
    preferCSSPageSize: true,
  });
  expect(deck.subarray(0, 5).toString()).toBe("%PDF-");
});
test("spreadsheet print uses selected range and displayed numeric formatting", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto("/");
  await page.locator(".create-card.sheets").click();
  const canvas = page.locator('canvas[id^="univer-sheet-main-canvas_"]');
  await canvas.click({ position: { x: 93, y: 40 } });
  await page.evaluate(() => navigator.clipboard.writeText("0.25\n0.5"));
  await page.keyboard.press("Control+v");
  // Paste leaves the two-cell range selected.
  await command(page, "sheet.percent");
  await command(page, "file.print");
  await expect(page.locator("#print-root td")).toHaveText(["25.00%", "50.00%"]);
  const pdf = await page.pdf({
    path: "artifacts/qa/sheets-print.pdf",
    preferCSSPageSize: true,
  });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
});
