// Real packaged WebKitGTK/WebView2 test via the official W3C Tauri driver.
// No test-only IPC commands or production security exceptions are added.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  mkdtemp,
  copyFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
const binary = resolve(process.env.NEXA_BINARY ?? "target/release/nexa-office");
const evidence = resolve(process.env.NEXA_QA_OUTPUT ?? "artifacts/native-qa");
const binaryHash = createHash("sha256");
for await (const chunk of createReadStream(binary)) binaryHash.update(chunk);
const binarySha256 = binaryHash.digest("hex");
const measuredAt = new Date().toISOString();
const driver = spawn(
  process.env.NEXA_DRIVER ?? "tauri-driver",
  ["--port", "4444"],
  {
    stdio: ["ignore", "pipe", "pipe"],
    // AppImage launchers can exit before their application children. Own a
    // process group so the test cannot leave those children/stdio behind.
    detached: process.platform === "linux",
  },
);
driver.stderr.on("data", (data) => process.stderr.write(data));
const base = "http://127.0.0.1:4444";
let session;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60000),
  });
  const json = await res.json();
  if (!res.ok || json.value?.error)
    throw new Error(JSON.stringify(json.value ?? json));
  return json.value;
}
const script = (source, args = []) =>
  request("POST", `/session/${session}/execute/sync`, { script: source, args });
async function until(fn, description, timeout = 30000) {
  const start = performance.now();
  let lastError;
  while (performance.now() - start < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      /* Driver/UI may still be starting. */
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out: ${description}`, { cause: lastError });
}
const element = (selector) =>
  request("POST", `/session/${session}/element`, {
    using: "css selector",
    value: selector,
  });
const elementId = (value) => value["element-6066-11e4-a52e-4f735466cecf"];
const click = async (selector) =>
  request(
    "POST",
    `/session/${session}/element/${elementId(await element(selector))}/click`,
    {},
  );
const type = async (selector, text) =>
  request(
    "POST",
    `/session/${session}/element/${elementId(await element(selector))}/value`,
    { text },
  );
const keys = async (text) =>
  request("POST", `/session/${session}/actions`, {
    actions: [
      {
        type: "key",
        id: "keyboard",
        actions: Array.from(text).flatMap((value) => [
          { type: "keyDown", value },
          { type: "keyUp", value },
          { type: "pause", duration: 25 },
        ]),
      },
    ],
  });
async function selectTab(kind) {
  await script(
    "Array.from(document.querySelectorAll('.document-tab [role=tab]')).find(b => b.textContent === arguments[0]).click()",
    [`Native ${kind}`],
  );
}
async function selectCell(column, row) {
  const point = await script(
    "const r = document.querySelector('canvas[id^=univer-sheet-main-canvas_]').getBoundingClientRect(); return { x: Math.round(r.left + 93 + arguments[0] * 100), y: Math.round(r.top + 40 + arguments[1] * 26) }",
    [column, row],
  );
  await request("POST", `/session/${session}/actions`, {
    actions: [
      {
        type: "pointer",
        id: "mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", duration: 0, origin: "viewport", ...point },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ],
  });
}
async function restartForRecovery() {
  await request("DELETE", `/session/${session}`);
  session = undefined;
  const response = await request("POST", "/session", {
    capabilities: {
      alwaysMatch: { "tauri:options": { application: binary, args: [] } },
    },
  });
  session = response.sessionId;
  await until(
    () => script("return !!document.querySelector('.recovery-list')"),
    "native recovery launcher",
  );
}
async function saveReopen(kind) {
  await click('button[aria-label="Save (Ctrl+S)"]');
  await until(
    () =>
      script(
        "return !document.querySelector('.document-tab.active .dirty-dot') && !document.querySelector('.progress-dialog')",
      ),
    `durable ${kind} save`,
  );
  await click(`button[aria-label="Close Native ${kind}"]`);
  await click(".wordmark");
  await until(
    () =>
      script(
        "return Array.from(document.querySelectorAll('.recent-row')).some(b => b.textContent.includes(arguments[0]))",
        [`Native ${kind}`],
      ),
    "recent native file",
  );
  await script(
    "Array.from(document.querySelectorAll('.recent-row')).find(b => b.textContent.includes(arguments[0])).click()",
    [`Native ${kind}`],
  );
  await until(
    () =>
      script(
        "return !!document.querySelector('.document-tab.active') && document.querySelector('.document-tab.active').textContent === arguments[0] && !document.querySelector('dialog[open]')",
        [`Native ${kind}`],
      ),
    `reopen ${kind}`,
  );
  const recent = (await ipc("list_recent")).find(
    (r) => r.title === `Native ${kind}`,
  );
  if (!recent) throw new Error("Native recent file missing");
  return (
    await ipc("open_recent", { id: recent.id, operation: crypto.randomUUID() })
  ).document;
}
const ipc = (command, args = {}) =>
  request("POST", `/session/${session}/execute/async`, {
    script:
      "const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(value => done({value}), error => done({error: String(error)}));",
    args: [command, args],
  }).then((result) => {
    if (result.error) throw new Error(result.error);
    return result.value;
  });
async function memory() {
  if (process.platform !== "linux") return null;
  const processes = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const status = await readFile(`/proc/${entry}/status`, "utf8");
      const name = status.match(/^Name:\s+(.+)/m)?.[1] ?? "";
      // Linux comm is truncated to 15 characters (WebKitWebProces).
      if (!/^(nexa-office|WebKitWebProces[s]?|WebKitNetworkPr.*)$/.test(name))
        continue;
      processes.push({
        name,
        pid: Number(entry),
        rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0),
        pssKiB: await readFile(`/proc/${entry}/smaps_rollup`, "utf8")
          .then((s) => Number(s.match(/^Pss:\s+(\d+)/m)?.[1] ?? 0))
          .catch(() => null),
      });
    } catch {
      /* A short-lived process exited. */
    }
  }
  return {
    processes,
    summedRssKiB: processes.reduce((n, p) => n + p.rssKiB, 0),
    summedPssKiB: processes.every((p) => p.pssKiB !== null)
      ? processes.reduce((n, p) => n + p.pssKiB, 0)
      : null,
    note: "Summed RSS double-counts shared pages; headless software-rendered runtime.",
  };
}
await mkdir(evidence, { recursive: true });
await writeFile(
  join(evidence, "run.json"),
  JSON.stringify(
    { status: "running", measuredAt, binary, binarySha256 },
    null,
    2,
  ),
);
try {
  await until(() => fetch(base + "/status").then((r) => r.ok), "test driver");
  const start = performance.now();
  const response = await request("POST", "/session", {
    capabilities: {
      alwaysMatch: { "tauri:options": { application: binary, args: [] } },
    },
  });
  session = response.sessionId;
  await until(
    () => script("return !!document.querySelector('.create-card.writer')"),
    "native Home",
  );
  const startupMs = performance.now() - start;
  await sleep(3000);
  const idleMemory = await memory();
  const diagnostics = await ipc("diagnostics");
  if (diagnostics.telemetry !== false)
    throw new Error("Telemetry unexpectedly enabled");
  await writeFile(
    join(evidence, "home.png"),
    Buffer.from(
      await request("GET", `/session/${session}/screenshot`),
      "base64",
    ),
  );
  await click(".create-card.writer");
  await until(
    () => script("return !!document.querySelector('.writer-document')"),
    "native Writer",
  );
  await type(".writer-document", "Native WebKit editing survives recovery.");
  const settings = await ipc("get_settings");
  await ipc("set_settings", { settings: { ...settings, autosaveSeconds: 5 } });
  // Exercise the real native snapshot command with the supported semantic model.
  const id = crypto.randomUUID();
  const doc = {
    schemaVersion: 1,
    id,
    title: "Native recovery probe",
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    revision: 3,
    metadata: {},
    content: {
      kind: "writer",
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Durable native recovery" }],
          },
        ],
      },
      page: {
        width: 794,
        height: 1123,
        margins: [76, 76, 76, 76],
        header: "",
        footer: "",
      },
    },
  };
  await ipc("autosave", { document: doc });
  const recovery = await ipc("list_recovery");
  if (!recovery.some((entry) => entry.id === id))
    throw new Error("Native recovery not persisted");
  const restored = await ipc("restore_recovery", { id });
  if (
    restored.document.content.body.content[0].content[0].text !==
    "Durable native recovery"
  )
    throw new Error("Native recovery changed content");
  await ipc("close_document", { id, discard: true });
  await click(".wordmark");
  await click(".create-card.sheets");
  await until(
    () =>
      script(
        "return !!document.querySelector('canvas[id^=univer-sheet-main-canvas_]')",
      ),
    "native canvas spreadsheet",
    45000,
  );
  await writeFile(
    join(evidence, "sheets.png"),
    Buffer.from(
      await request("GET", `/session/${session}/screenshot`),
      "base64",
    ),
  );
  await click(".wordmark");
  await click(".create-card.slides");
  await until(
    () => script("return !!document.querySelector('.slide-stage')"),
    "native Slides",
  );
  await writeFile(
    join(evidence, "slides.png"),
    Buffer.from(
      await request("GET", `/session/${session}/screenshot`),
      "base64",
    ),
  );
  const result = {
    measuredAt,
    platform: process.platform,
    binary,
    binarySha256,
    startupMsIncludingWebDriver: startupMs,
    idleSettledMs: 3000,
    idleMemory,
    diagnostics,
    workflows: [
      "native Home",
      "Writer typing",
      "Rust autosave/list/restore/discard",
      "Sheets canvas + worker startup",
      "Slides startup",
    ],
    editorMemory: await memory(),
  };
  // A second process opens copies of real native fixtures via OS command-line
  // grants. All saves use the normal toolbar and Rust's actual durable path.
  await request("DELETE", `/session/${session}`);
  session = undefined;
  const scratch = await mkdtemp(join(tmpdir(), "nexa-native-qa-"));
  const paths = [];
  for (const [kind, ext] of [
    ["writer", "nxd"],
    ["sheets", "nxs"],
    ["slides", "nxp"],
  ]) {
    const path = join(scratch, `${kind}.${ext}`);
    await copyFile(resolve(`artifacts/native-inputs/${kind}.${ext}`), path);
    paths.push(path);
  }
  const nextSession = await request("POST", "/session", {
    capabilities: {
      alwaysMatch: { "tauri:options": { application: binary, args: paths } },
    },
  });
  session = nextSession.sessionId;
  await until(
    () =>
      script(
        "return document.querySelectorAll('.document-tab').length === 3 && !document.querySelector('dialog[open]')",
      ),
    "three native documents",
    60000,
  );
  await script(`
    window.nexaQaInputEvents = [];
    for (const type of ['focusin', 'focusout', 'keydown', 'input']) {
      document.addEventListener(type, event => {
        window.nexaQaInputEvents.push({
          type, key: event.key, tag: event.target.tagName,
          className: String(event.target.className), id: event.target.id,
          length: event.target.value?.length,
        });
      }, true);
    }
  `);
  await selectTab("writer");
  await until(
    () => script("return !!document.querySelector('.writer-document')"),
    "native Writer loaded",
  );
  await type(".writer-document", "Durable native Writer edit. ");
  const writer = await saveReopen("writer");
  if (!JSON.stringify(writer.content).includes("Durable native Writer edit. "))
    throw new Error("Native Writer save/reopen lost text");
  await ipc("autosave", { document: writer });
  await ipc("discard_recovery", { id: writer.id });
  const afterDiscard = await ipc("save_document", {
    document: writer,
    saveAs: false,
    format: null,
    operation: crypto.randomUUID(),
  });
  if (afterDiscard?.path !== paths[0])
    throw new Error("Discarding recovery lost the active native file session");
  await selectTab("sheets");
  await until(
    () =>
      script(
        "return !!document.querySelector('canvas[id^=univer-sheet-main-canvas_]')",
      ),
    "native worksheet ready",
    60000,
  );
  await selectCell(1, 0);
  // Deliberately save without Enter: Save must commit the active cell editor.
  await keys("=SUM(A1:A2)");
  // Calculation runs in the real bundled worker. Poll durable saves until its
  // cached result is available, rather than assuming a machine-specific delay.
  let spreadsheet;
  await until(
    async () => {
      if (await script("return !!document.querySelector('.progress-dialog')"))
        return false;
      await click('button[aria-label="Save (Ctrl+S)"]');
      // A formula result may arrive after the save captured its revision. That
      // correctly leaves the tab dirty: retry the durable save, do not wait
      // forever for an older revision to magically become current.
      const recent = (await ipc("list_recent")).find(
        (r) => r.title === "Native sheets",
      );
      spreadsheet = (
        await ipc("open_recent", {
          id: recent.id,
          operation: crypto.randomUUID(),
        })
      ).document;
      return (
        spreadsheet.content.workbook.sheets[0].cells[0]?.[1]?.value === 32.5
      );
    },
    "native formula evaluates to 32.5",
    30000,
  );
  spreadsheet = await saveReopen("sheets");
  if (spreadsheet.content.workbook.sheets[0].cells[0]?.[1]?.value !== 32.5)
    throw new Error("Native spreadsheet cached formula changed");
  await selectTab("slides");
  await until(
    () => script("return !!document.querySelector('.speaker-notes textarea')"),
    "native presentation ready",
  );
  await type(".speaker-notes textarea", "Durable native presentation edit. ");
  await until(
    () =>
      script(
        "return document.querySelector('.speaker-notes textarea').value.includes('Durable native presentation edit. ')",
      ),
    "notes input committed",
  );
  const slides = await saveReopen("slides");
  if (
    !slides.content.deck.slides.some((s) =>
      s.notes.includes("Durable native presentation edit. "),
    )
  )
    throw new Error("Native slide save lost notes");
  result.workflows.push(
    "Writer native edit/save/close/reopen",
    "Sheets native formula worker/save/close/reopen",
    "Slides native edit/save/close/reopen",
    "Discard recovery retains active native path and lock",
  );
  // Exercise the real timed recovery path while a cell remains unfinished,
  // then read it from a fresh native process and restore through the UI.
  await selectTab("sheets");
  await until(
    () =>
      script(
        "return !!document.querySelector('canvas[id^=univer-sheet-main-canvas_]')",
      ),
    "worksheet before recovery probe",
  );
  await selectCell(1, 0);
  await keys("=SUM(A1");
  const lastKeyStarted = Date.now();
  await keys(":");
  await until(
    async () =>
      (await ipc("list_recovery")).some(
        (entry) =>
          entry.id === spreadsheet.id && entry.modifiedAt >= lastKeyStarted,
      ),
    "timed snapshot of unfinished native cell",
  );
  await restartForRecovery();
  const recoveredDraft = await ipc("restore_recovery", { id: spreadsheet.id });
  const draftRecord = recoveredDraft.document;
  if (
    draftRecord.recoveryDraft?.text !== "=SUM(A1:" ||
    draftRecord.content.workbook.sheets[0].cells[0]?.[1]?.value !== 32.5
  )
    throw new Error(
      "Native timed recovery lost the draft or changed its committed cell",
    );
  // Release the inspected native session; the normal Restore button owns the
  // next session. The persisted snapshot is deliberately retained.
  await ipc("close_document", { id: spreadsheet.id, discard: false });
  await script(
    "Array.from(document.querySelectorAll('.recovery-list article')).find(a => a.querySelector('h3').textContent === 'Native sheets').querySelector('button.primary').click()",
  );
  await until(
    () =>
      script(
        "return !!document.querySelector('canvas[id^=univer-sheet-main-canvas_]') && document.querySelector('[role=status]')?.textContent.includes('Unfinished cell input')",
      ),
    "unfinished input recovery notice and editor",
  );
  await until(
    async () =>
      (await ipc("list_recovery")).some(
        (entry) =>
          entry.id === spreadsheet.id && entry.revision > draftRecord.revision,
      ),
    "restored literal cell autosaved through native persistence",
  );
  await restartForRecovery();
  const reviewed = (await ipc("restore_recovery", { id: spreadsheet.id }))
    .document;
  const literalCell = reviewed.content.workbook.sheets[0].cells[0]?.[1];
  if (
    reviewed.recoveryDraft ||
    literalCell?.value !== "=SUM(A1:" ||
    literalCell.formula
  )
    throw new Error(
      "Native recovery did not retain the unfinished formula as literal text",
    );
  result.workflows.push(
    "Timed unfinished-cell recovery across native process restarts",
  );
  await writeFile(
    join(evidence, "results.json"),
    JSON.stringify(result, null, 2),
  );
  await writeFile(
    join(evidence, "run.json"),
    JSON.stringify(
      { status: "passed", measuredAt, binary, binarySha256 },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(
    join(evidence, "run.json"),
    JSON.stringify(
      {
        status: "failed",
        measuredAt,
        binary,
        binarySha256,
        error: String(error),
      },
      null,
      2,
    ),
  );
  if (session) {
    console.error(
      "NATIVE DOM",
      await script("return document.body.innerText").catch(() => "unavailable"),
    );
    const inputDiagnostic = await script(
      "return { active: {tag: document.activeElement?.tagName, id: document.activeElement?.id}, events: window.nexaQaInputEvents }",
    ).catch(() => ({}));
    await writeFile(
      join(evidence, "input-diagnostic.json"),
      JSON.stringify(inputDiagnostic, null, 2),
    );
    console.error(
      "NATIVE INPUT DIAGNOSTIC",
      JSON.stringify({
        ...inputDiagnostic,
        events: inputDiagnostic.events?.slice(-90),
      }),
    );
    await writeFile(
      join(evidence, "failure.png"),
      Buffer.from(
        await request("GET", `/session/${session}/screenshot`).catch(() => ""),
        "base64",
      ),
    );
  }
  throw error;
} finally {
  if (session) await request("DELETE", `/session/${session}`).catch(() => {});
  try {
    if (process.platform === "linux" && driver.pid)
      process.kill(-driver.pid, "SIGTERM");
    else driver.kill("SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") {
      console.error(
        "Could not stop the owned native test process group:",
        error,
      );
      process.exitCode = 1;
    }
  }
}
