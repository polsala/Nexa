import { chromium } from "@playwright/test";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
const results = [];
const allEditors = process.argv.includes("--all");
const report = `artifacts/benchmarks/${allEditors ? "ui-all-results" : "ui-results"}.json`;
await mkdir("artifacts/benchmarks/history", { recursive: true });
try {
  // Keep earlier measurements instead of silently replacing the evidence when
  // a shared machine produces a faster or slower follow-up sample.
  await copyFile(
    report,
    `artifacts/benchmarks/history/previous-ui-${new Date().toISOString().replaceAll(":", "-")}.json`,
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const workloads = allEditors
  ? [
      ["writer", [1, 50, 300]],
      ["sheets", [1000, 100000, 1000000]],
      ["slides", [10, 100, 300]],
    ].flatMap(([kind, sizes]) => sizes.map((size) => ({ kind, size })))
  : (process.argv.slice(2).length
      ? process.argv.slice(2).map(Number)
      : [1000, 100000, 1000000]
    ).map((size) => ({ kind: "sheets", size }));
for (const { kind, size } of workloads) {
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new Error("Invalid benchmark size");
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.NEXA_CHROMIUM_PATH ??
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1360, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.NEXA_URL ?? "http://127.0.0.1:1420");
    await page.evaluate(() => {
      globalThis.nexaLongTasks = [];
      new PerformanceObserver((entries) =>
        globalThis.nexaLongTasks.push(
          ...entries.getEntries().map((e) => e.duration),
        ),
      ).observe({ type: "longtask", buffered: true });
    });
    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: "Open file", exact: true })
      .first()
      .click();
    const start = performance.now();
    const extension = { writer: "nxd", sheets: "nxs", slides: "nxp" }[kind];
    await (
      await chooser
    ).setFiles(`artifacts/benchmarks/${kind}-${size}.${extension}`);
    await page
      .locator(
        kind === "writer"
          ? ".writer-document"
          : kind === "slides"
            ? ".slide-stage"
            : 'canvas[id^="univer-sheet-main-canvas_"]',
      )
      .waitFor({ timeout: 180000 });
    if (kind === "sheets")
      await page.waitForFunction(
        (count) =>
          document
            .querySelector(".status-bar")
            ?.textContent.includes(
              new Intl.NumberFormat("en-GB").format(count),
            ),
        size,
        { timeout: 180000 },
      );
    if (kind === "slides")
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll(".slide-thumbnail").length === count,
        size,
        { timeout: 180000 },
      );
    if (kind === "writer")
      await page.waitForFunction(
        (count) =>
          document
            .querySelector(".writer-document")
            ?.textContent.includes(`page ${count}`),
        size,
        { timeout: 180000 },
      );
    const openMs = performance.now() - start;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const metrics = (await cdp.send("Performance.getMetrics")).metrics;
    const heapUsedBytes = metrics.find(
      (m) => m.name === "JSHeapUsedSize",
    )?.value;
    const nodes = await page.locator("*").count();
    const longTasks = await page.evaluate(() => globalThis.nexaLongTasks);
    await page.evaluate(() => {
      globalThis.nexaLongTasks = [];
    });
    await page
      .locator(
        kind === "writer"
          ? ".writer-scroll"
          : kind === "slides"
            ? ".slide-navigator"
            : 'canvas[id^="univer-sheet-main-canvas_"]',
      )
      .hover();
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(50);
    }
    const scrollLongTasks = await page.evaluate(() => globalThis.nexaLongTasks);
    const result = {
      kind,
      size,
      measuredAt: new Date().toISOString(),
      browser: browser.version(),
      openMs,
      heapUsedBytes,
      domNodes: nodes,
      openLongTaskCount: longTasks.length,
      longestOpenTaskMs: Math.max(0, ...longTasks),
      scrollingLongTaskCount: scrollLongTasks.length,
      longestScrollingTaskMs: Math.max(0, ...scrollLongTasks),
      errors,
      mode: (await page
        .locator("script[src]")
        .evaluateAll((scripts) =>
          scripts.some((script) =>
            new URL(script.src).pathname.startsWith("/assets/"),
          ),
        ))
        ? "production preview / Chromium headless"
        : "Vite development / Chromium headless",
    };
    results.push(result);
    console.log(JSON.stringify(result));
    await mkdir("artifacts/benchmarks", { recursive: true });
    await page.screenshot({ path: `artifacts/benchmarks/${kind}-${size}.png` });
    await writeFile(report, JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
}
