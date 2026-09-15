// Browser development adapter only. Desktop builds route every save through Rust.
import { zip, unzip, strToU8, strFromU8 } from "fflate";
import {
  parseDocument,
  type NexaDocument,
  type Properties,
} from "../editor-core/model";
const mime = {
  writer: "application/vnd.nexa.document",
  sheets: "application/vnd.nexa.spreadsheet",
  slides: "application/vnd.nexa.presentation",
};
const hash = async (b: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(b).buffer),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
export async function encodeNative(doc: NexaDocument): Promise<Uint8Array> {
  // Keep imported, non-editable parts even in the development browser adapter.
  const source =
    typeof indexedDB === "undefined"
      ? undefined
      : await record<Record<string, Uint8Array>>("sources", doc.id);
  const parts: Record<string, Uint8Array> = {
    ...source,
    "content.json": strToU8(JSON.stringify(doc)),
    "metadata.json": strToU8(
      JSON.stringify({ title: doc.title, modifiedAt: doc.modifiedAt }),
    ),
  };
  const checksums = Object.fromEntries(
    await Promise.all(
      Object.entries(parts).map(async ([key, bytes]) => [
        key,
        await hash(bytes),
      ]),
    ),
  );
  parts["manifest.json"] = strToU8(
    JSON.stringify({
      format: "nexa",
      schemaVersion: 1,
      mime: mime[doc.content.kind],
      documentId: doc.id,
      editor: "Nexa Office",
      editorVersion: "0.1.0",
      checksums,
    }),
  );
  return new Promise((resolve, reject) =>
    zip(parts, { level: 6 }, (e, data) => (e ? reject(e) : resolve(data))),
  );
}
export async function decodeNative(bytes: Uint8Array): Promise<NexaDocument> {
  if (bytes.length > 512 * 1024 * 1024) throw new Error("File too large");
  let total = 0;
  let invalid = false;
  const seen = new Set<string>();
  const files = await new Promise<Record<string, Uint8Array>>(
    (resolve, reject) =>
      unzip(
        bytes,
        {
          filter: (f) => {
            total += f.originalSize;
            const valid =
              !f.name.startsWith("/") &&
              !f.name.includes("\\") &&
              !f.name.includes(":") &&
              !f.name.split("/").includes("..") &&
              f.originalSize <= 256 * 1024 * 1024 &&
              total <= 1024 * 1024 * 1024 &&
              seen.size < 16384 &&
              !seen.has(f.name) &&
              (f.originalSize < 1024 * 1024 || f.originalSize <= f.size * 500);
            seen.add(f.name);
            invalid ||= !valid;
            return valid;
          },
        },
        (e, data) =>
          e
            ? reject(e)
            : invalid
              ? reject(new Error("Unsafe document archive"))
              : resolve(data),
      ),
  );
  if (!files["manifest.json"] || !files["content.json"])
    throw new Error("Missing manifest or content");
  const manifest = JSON.parse(strFromU8(files["manifest.json"])) as {
    format: string;
    schemaVersion: number;
    checksums: Record<string, string>;
    documentId: string;
    mime: string;
  };
  if (
    manifest.format !== "nexa" ||
    manifest.schemaVersion > 1 ||
    Object.keys(manifest.checksums).length !== Object.keys(files).length - 1
  )
    throw new Error("Unsupported or incomplete archive manifest");
  for (const [name, checksum] of Object.entries(manifest.checksums))
    if (!files[name] || (await hash(files[name])) !== checksum)
      throw new Error(`Integrity check failed: ${name}`);
  const data: unknown = JSON.parse(strFromU8(files["content.json"]));
  const hydrate = (v: unknown): unknown => {
    if (typeof v === "string" && v.startsWith("asset://assets/")) {
      const path = v.slice(8);
      const b = files[path];
      if (!b) throw new Error("Missing image asset");
      const ext = path.split(".").pop();
      if (!["png", "jpg", "webp"].includes(ext ?? ""))
        throw new Error("Invalid image format");
      let binary = "";
      for (const c of b) binary += String.fromCharCode(c);
      return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${btoa(binary)}`;
    }
    if (Array.isArray(v)) return v.map(hydrate);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, c]) => [k, hydrate(c)]),
      );
    return v;
  };
  const doc = parseDocument(hydrate(data));
  if (
    doc.id !== manifest.documentId ||
    mime[doc.content.kind] !== manifest.mime
  )
    throw new Error("Manifest identity mismatch");
  const source = Object.fromEntries(
    Object.entries(files).filter(
      ([name]) =>
        name.startsWith("original/") ||
        name.startsWith("compatibility/") ||
        name.startsWith("previews/"),
    ),
  );
  if (typeof indexedDB !== "undefined") await put("sources", doc.id, source);
  return doc;
}
let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("nexa-office", 2);
    req.onupgradeneeded = () => {
      for (const store of ["documents", "recovery", "sources"])
        if (!req.result.objectStoreNames.contains(store))
          req.result.createObjectStore(store);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
export async function record<T>(
  store: string,
  key: string,
): Promise<T | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}
export async function records<T>(store: string): Promise<T[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}
export async function put(
  store: string,
  key: string,
  value: unknown,
): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export async function remove(store: string, key: string): Promise<void> {
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
export function download(
  bytes: Uint8Array,
  name: string,
  type = "application/octet-stream",
): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export const readSettings = (): Properties => {
  try {
    return JSON.parse(
      localStorage.getItem("nexa-settings") ?? "{}",
    ) as Properties;
  } catch {
    return {};
  }
};
