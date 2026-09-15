import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "target/release/bundle");
async function packages(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await packages(path)));
    else if (entry.isFile() && /\.(deb|AppImage|exe|msi)$/.test(entry.name))
      result.push(path);
  }
  return result;
}
const paths = (await packages(root)).sort();
if (!paths.length) throw new Error(`No release packages found in ${root}`);
const lines = [];
for (const path of paths) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const name = relative(root, path).split(sep).join("/");
  if (/[\r\n\\]/.test(name)) throw new Error("Unsupported package filename");
  lines.push(`${hash.digest("hex")}  ${name}`);
}
await writeFile(join(root, "SHA256SUMS"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
