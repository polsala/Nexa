import { chromium } from "@playwright/test";
const browser = await chromium.launch({
  executablePath: process.env.NEXA_CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type())) console.log("CONSOLE", m.text());
});
page.on("pageerror", (e) => console.log("ERROR", e.stack));
await page.goto("http://127.0.0.1:1420");
await page.locator(`.create-card.${process.argv[2] ?? "writer"}`).click();
await page.waitForTimeout(2500);
console.log("DETAILS", await page.locator("pre").allTextContents());
console.log(
  "STATE",
  await page.evaluate(async () => {
    const { workspace } = await import("/packages/shell/workspace.ts");
    const state = workspace.get();
    return {
      active: state.active,
      sessions: state.sessions.map((s) => ({
        id: s.document.id,
        kind: s.document.content.kind,
        ready: !!s.engine,
      })),
    };
  }),
);
console.log(
  "INPUTS",
  await page
    .locator("input,textarea,[contenteditable=true],canvas")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        tag: n.tagName,
        id: n.id,
        label: n.getAttribute("aria-label"),
        role: n.getAttribute("role"),
        width: n.getBoundingClientRect().width,
        height: n.getBoundingClientRect().height,
      })),
    ),
);
await page.screenshot({
  path: `artifacts/qa/inspect-${process.argv[2] ?? "writer"}.png`,
});
await browser.close();
