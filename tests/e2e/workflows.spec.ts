import { test, expect, type Page } from "@playwright/test";
async function command(page: Page, query: string) {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("combobox");
  await input.fill(query);
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await input.press("Enter");
}
test("home, Writer edit, table, native save and reopen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Make room for your ideas." }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/qa/home.png", fullPage: true });
  await page.getByRole("button", { name: /New document Give/ }).click();
  const editor = page.getByRole("textbox", { name: "Document", exact: true });
  await editor.fill(
    "A useful office suite\nA local document with café, català and español.",
  );
  await editor.press("Control+Home");
  await page
    .getByRole("combobox", { name: "Format", exact: true })
    .selectOption("writer.heading1");
  await editor.press("Control+End");
  await editor.press("Enter");
  await command(page, "writer.insertTable");
  await expect(page.locator(".writer-document table")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const file = await download;
  await file.saveAs("artifacts/qa/writer.nxd");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/qa/writer.png", fullPage: true });
  await page
    .getByRole("button", { name: "Close Untitled 1", exact: true })
    .click();
  await page.getByRole("button", { name: /Untitled 1 Writer/ }).click();
  await expect(editor).toContainText("A useful office suite");
  await expect(page.locator(".writer-document table")).toBeVisible();
  expect(errors).toEqual([]);
});
test("Sheets formula editing and round trip uses a canvas grid", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New spreadsheet Turn/ }).click();
  const canvas = page.locator('canvas[id^="univer-sheet-main-canvas_"]');
  await expect(canvas).toBeVisible();
  await page.screenshot({
    path: "artifacts/qa/sheets-initial.png",
    fullPage: true,
  });
  await canvas.click({ position: { x: 93, y: 40 } });
  await page.keyboard.type("12");
  await page.keyboard.press("Enter");
  await page.keyboard.type("20");
  await page.keyboard.press("Enter");
  await page.keyboard.type("=SUM(A1:A2)");
  await page.keyboard.press("Enter");
  const values = () =>
    page.evaluate(async () => {
      const path = "/packages/shell/workspace.ts";
      const { workspace } = (await import(
        path
      )) as typeof import("../../packages/shell/workspace");
      const content = workspace.active()?.engine?.snapshot();
      return content?.kind === "sheets"
        ? content.workbook.sheets[0]?.cells
        : null;
    });
  await expect.poll(async () => (await values())?.[2]?.[0]?.value).toBe(32);
  await command(page, "sheet.newSheet");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Second");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.screenshot({ path: "artifacts/qa/sheets.png", fullPage: true });
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  await (await download).saveAs("artifacts/qa/sheets.nxs");
  await expect(
    page.getByText("All changes saved", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close Untitled 1", exact: true })
    .click();
  await page.getByRole("button", { name: /Untitled 1 Sheets/ }).click();
  await expect.poll(async () => (await values())?.[2]?.[0]?.value).toBe(32);
  expect(
    await page.locator('[data-testid="spreadsheet-canvas"] canvas').count(),
  ).toBeGreaterThan(0);
  expect(
    await page.locator('[data-testid="spreadsheet-canvas"] td').count(),
  ).toBeLessThan(100);
});
test("Slides edit, objects, notes, undo, native save and reopen", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New presentation Bring/ }).click();
  await command(page, "slides.insert.text");
  await expect(page.locator("[data-object-id]")).toHaveCount(2);
  await page.locator(".slide-canvas-wrap [data-object-id]").dblclick();
  const editor = page.getByRole("textbox", { name: "Text box", exact: true });
  await editor.fill("A real local presentation");
  await editor.press("Escape");
  await page
    .getByRole("textbox", { name: "Speaker notes", exact: true })
    .fill("Notes survive saving.");
  await command(page, "slides.insert.rectangle");
  await command(page, "slides.addSlide");
  await expect(page.locator(".slide-thumbnail")).toHaveCount(2);
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  await (await download).saveAs("artifacts/qa/slides.nxp");
  await page.screenshot({ path: "artifacts/qa/slides.png", fullPage: true });
  await page
    .getByRole("button", { name: "Close Untitled 1", exact: true })
    .click();
  await page.getByRole("button", { name: /Untitled 1 Slides/ }).click();
  await expect(page.locator(".slide-thumbnail")).toHaveCount(2);
});
test("recovery, settings and command palette are usable offline", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Recovery interval (seconds)" })
    .fill("5");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Nexa Office", exact: true }).click();
  await page.getByRole("button", { name: /New document Give/ }).click();
  await page
    .getByRole("textbox", { name: "Document", exact: true })
    .fill("Recover this work after a crash");
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const req = indexedDB.open("nexa-office");
          const db = await new Promise<IDBDatabase>((resolve) => {
            req.onsuccess = () => resolve(req.result);
          });
          return new Promise<number>((resolve) => {
            const count = db
              .transaction("recovery")
              .objectStore("recovery")
              .count();
            count.onsuccess = () => resolve(count.result);
          });
        }),
      { timeout: 15000 },
    )
    .toBe(1);
  const other = await context.newPage();
  await other.goto("/");
  await expect(
    other.getByRole("button", { name: "Restore", exact: true }),
  ).toBeVisible();
  await other.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    other.getByRole("textbox", { name: "Document", exact: true }),
  ).toContainText("Recover this work after a crash");
  await other.getByRole("button", { name: "Nexa Office", exact: true }).click();
  await other.getByRole("button", { name: "Settings", exact: true }).click();
  await other
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("ca");
  await expect(
    other.getByRole("heading", { name: "Fes com a casa" }),
  ).toBeVisible();
});
