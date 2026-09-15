// Optional independent interoperability check. LibreOffice is never a runtime dependency.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const exec = promisify(execFile);
const profile = await mkdtemp(join(tmpdir(), "nexa-office-compat-"));
const results = [];
for (const ext of ["docx", "xlsx", "pptx"]) {
  const directory = resolve("artifacts/compatibility", ext);
  await mkdir(directory, { recursive: true });
  const input = resolve(`tests/fixtures/${ext}/semantic.${ext}`);
  const result = await exec(
    "libreoffice",
    [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      directory,
      input,
    ],
    { timeout: 60000 },
  );
  const pdf = await readFile(join(directory, "semantic.pdf"));
  if (pdf.subarray(0, 5).toString() !== "%PDF-")
    throw new Error(`Invalid independent PDF for ${ext}`);
  const info = await exec("pdfinfo", [join(directory, "semantic.pdf")]);
  const row = {
    format: ext,
    pdfBytes: pdf.length,
    output: result.stdout.trim(),
    pages: Number(info.stdout.match(/Pages:\s+(\d+)/)?.[1]),
  };
  results.push(row);
  console.log(row);
}
await writeFile(
  "artifacts/compatibility/results.json",
  JSON.stringify(
    {
      converter: (await exec("libreoffice", ["--version"])).stdout.trim(),
      results,
    },
    null,
    2,
  ),
);
