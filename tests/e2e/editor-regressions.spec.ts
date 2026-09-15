import { test, expect, type Page } from "@playwright/test";
import type { NexaDocument } from "../../packages/editor-core/model";
async function recovery(page: Page) {
  return page.evaluate(async () => {
    const path = "/packages/shell/browser-files.ts";
    const { records } = (await import(
      path
    )) as typeof import("../../packages/shell/browser-files");
    return (await records<NexaDocument>("recovery"))[0];
  });
}
async function command(page: Page, id: string) {
  await page.keyboard.press("Control+k");
  const input = page.getByRole("dialog").getByRole("combobox");
  await input.fill(id);
  await expect(page.getByRole("dialog").getByRole("option")).toHaveCount(1);
  await input.press("Enter");
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const path = "/packages/shell/workspace.ts";
    const { workspace } = (await import(
      path
    )) as typeof import("../../packages/shell/workspace");
    return workspace.active()?.engine?.snapshot();
  });
}
test("background editor cannot interrupt Writer; image and rich clipboard survive native save", async ({
  page,
}) => {
  const external: string[] = [];
  await page.route("**/*", (route) => {
    if (
      /^https?:\/\//.test(route.request().url()) &&
      !route.request().url().startsWith("http://127.0.0.1:1420")
    ) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/");
  await page.locator(".create-card.sheets").click();
  // Switch away while the heavy editor is still loading.
  await page.locator(".wordmark").click();
  await page.locator(".create-card.writer").click();
  const editor = page.getByRole("textbox", { name: "Document", exact: true });
  await editor.pressSequentially(
    "Background tabs must never steal this sentence.",
    { delay: 30 },
  );
  await expect(editor).toContainText(
    "Background tabs must never steal this sentence.",
  );
  await editor.evaluate((el) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "\nBrowser clipboard");
    clipboard.setData(
      "text/html",
      "<p><strong>Browser clipboard</strong></p><table><tr><td>12</td><td>20</td></tr></table>",
    );
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }),
    );
  });
  await expect(editor.locator("strong")).toContainText("Browser clipboard");
  await expect(editor.locator("table")).toHaveCount(1);
  await editor.press("Control+End");
  await editor.evaluate(async (el) => {
    const canvas = document.createElement("canvas");
    canvas.width = 20;
    canvas.height = 20;
    canvas.getContext("2d")?.fillRect(0, 0, 20, 20);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Test image creation failed")),
        "image/png",
      ),
    );
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([png], "pixel.png", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }),
    );
  });
  await expect(editor.locator("img[src]")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  await (await download).saveAs("artifacts/qa/writer-image.nxd");
  await expect(page.locator(".save-status")).toContainText("All changes saved");
  await page
    .getByRole("button", { name: "Close Untitled 2", exact: true })
    .click();
  await page.locator(".wordmark").click();
  await page.locator(".recent-row").filter({ hasText: "Untitled 2" }).click();
  await expect(editor.locator("img[src]")).toHaveCount(1);
  expect(external).toEqual([]);
});
test("slide undo clamps selection, clipboard copies are independent, distribute is undoable", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".create-card.slides").click();
  await command(page, "slides.addSlide");
  await command(page, "edit.undo");
  await expect(page.locator(".slide-thumbnail")).toHaveCount(1);
  await command(page, "slides.insert.rectangle");
  const stage = page.locator(".slide-stage");
  await stage.focus();
  const clipboard = await stage.evaluate((el) => {
    const data = new DataTransfer();
    el.dispatchEvent(
      new ClipboardEvent("copy", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
    return data.getData("application/x-nexa-slide-objects+json");
  });
  for (let i = 0; i < 2; i++)
    await stage.evaluate((el, content) => {
      const data = new DataTransfer();
      data.setData("application/x-nexa-slide-objects+json", content);
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    }, clipboard);
  let doc = await snapshot(page);
  expect(doc?.kind === "slides" && doc.deck.slides[0]?.objects.length).toBe(3);
  await stage.press("Control+a");
  await command(page, "slides.distribute.x");
  await command(page, "edit.undo");
  await command(page, "edit.redo");
  doc = await snapshot(page);
  expect(
    doc?.kind === "slides" &&
      new Set(doc.deck.slides[0]?.objects.map((o) => o.id)).size,
  ).toBe(3);
  await command(page, "edit.undo");
  await command(page, "edit.undo");
  doc = await snapshot(page);
  expect(doc?.kind === "slides" && doc.deck.slides[0]?.objects.length).toBe(2);
});

test("Save commits an unfinished cell edit and retains it on reopen", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".create-card.sheets").click();
  const canvas = page.locator('canvas[id^="univer-sheet-main-canvas_"]');
  await expect(canvas).toBeVisible();
  await canvas.click({ position: { x: 93, y: 40 } });
  await page.keyboard.type("Uncommitted cell input");
  const download = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  await (await download).saveAs("artifacts/qa/sheets-pending-input.nxs");
  await expect(page.locator(".save-status")).toContainText("All changes saved");
  await page
    .getByRole("button", { name: "Close Untitled 1", exact: true })
    .click();
  await page.locator(".recent-row").filter({ hasText: "Untitled 1" }).click();
  await expect
    .poll(async () => {
      const content = await snapshot(page);
      return content?.kind === "sheets"
        ? content.workbook.sheets[0]?.cells[0]?.[0]?.value
        : null;
    })
    .toBe("Uncommitted cell input");
});

test("timed recovery preserves unfinished formulas without committing them and clears cancelled drafts", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Recovery interval (seconds)" })
    .fill("5");
  await page.locator(".wordmark").click();
  await page.locator(".create-card.sheets").click();
  const canvas = page.locator('canvas[id^="univer-sheet-main-canvas_"]');
  await expect(canvas).toBeVisible();
  await canvas.click({ position: { x: 93, y: 40 } });
  await page.keyboard.type("42");
  await page.keyboard.press("Enter");
  const saved = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  await saved;
  await expect(page.locator(".save-status")).toContainText("All changes saved");
  await canvas.click({ position: { x: 93, y: 40 } });
  await page.keyboard.type("=SUM(A2:");
  await expect(page.locator(".save-status")).toContainText("Unsaved changes");
  await expect
    .poll(async () => (await recovery(page))?.recoveryDraft?.text)
    .toBe("=SUM(A2:");
  const captured = await recovery(page);
  expect(
    captured?.content.kind === "sheets" &&
      captured.content.workbook.sheets[0]?.cells[0]?.[0]?.value,
  ).toBe(42);
  // Recovery must not move focus, confirm an incomplete formula or end editing.
  await page.keyboard.type("A3)");
  await expect
    .poll(async () => (await recovery(page))?.recoveryDraft?.text)
    .toBe("=SUM(A2:A3)");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await recovery(page))?.recoveryDraft)
    .toBeUndefined();
  const cancelled = await snapshot(page);
  expect(
    cancelled?.kind === "sheets" &&
      cancelled.workbook.sheets[0]?.cells[0]?.[0]?.value,
  ).toBe(42);

  await canvas.click({ position: { x: 93, y: 40 } });
  await page.keyboard.type("=SUM(A2:");
  await expect
    .poll(async () => (await recovery(page))?.recoveryDraft?.text)
    .toBe("=SUM(A2:");
  // A fresh WebView restores persisted data; the original page does not run
  // the application's explicit close/discard flow (simulated abrupt exit).
  await page.close();
  const restored = await context.newPage();
  await restored.goto("/");
  await restored.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(
    restored.getByRole("status").filter({ hasText: "Unfinished cell input" }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const content = await snapshot(restored);
      return content?.kind === "sheets"
        ? content.workbook.sheets[0]?.cells[0]?.[0]?.value
        : null;
    })
    .toBe("=SUM(A2:");
  const literal = await snapshot(restored);
  expect(
    literal?.kind === "sheets" &&
      literal.workbook.sheets[0]?.cells[0]?.[0]?.formula,
  ).toBeUndefined();
  await command(restored, "edit.undo");
  const undone = await snapshot(restored);
  expect(
    undone?.kind === "sheets" &&
      undone.workbook.sheets[0]?.cells[0]?.[0]?.value,
  ).toBe(42);
  await command(restored, "edit.redo");
  const download = restored.waitForEvent("download");
  await restored.keyboard.press("Control+s");
  await (await download).saveAs("artifacts/qa/sheets-recovered-draft.nxs");
  await expect(restored.locator(".save-status")).toContainText(
    "All changes saved",
  );
  await expect.poll(async () => await recovery(restored)).toBeUndefined();
});
