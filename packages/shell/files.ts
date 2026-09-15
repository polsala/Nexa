import { invoke, isTauri } from "@tauri-apps/api/core";
import { branding } from "../theme/branding";
import { defaults, type Settings } from "../settings";
import { imageDimensions } from "./image-safety";
import {
  type NexaDocument,
  type Kind,
  uid,
  plainText,
} from "../editor-core/model";
export const desktop = isTauri();
const cancelled = new Set<string>();
function checkpoint(operation?: string) {
  if (operation && cancelled.delete(operation))
    throw new Error("Operation cancelled");
}
export interface Recent {
  id: string;
  title: string;
  kind: Kind;
  path: string;
  modifiedAt: number;
  preview: string;
}
export interface Recovery {
  id: string;
  title: string;
  kind: Kind;
  modifiedAt: number;
  revision: number;
}
export interface Opened {
  document: NexaDocument;
  path: string | null;
  warnings: string[];
}
interface Stored {
  document: NexaDocument;
  path: string;
}
export async function openFile(operation: string): Promise<Opened | null> {
  if (desktop) return invoke("open_document", { operation });
  const browser = await import("./browser-files");
  const f = await browser.pickFile(".nxd,.nxs,.nxp");
  checkpoint(operation);
  return f ? openBrowserFile(f, operation) : null;
}
export async function openBrowserFile(
  file: File,
  operation?: string,
): Promise<Opened> {
  const browser = await import("./browser-files");
  const document = await browser.decodeNative(
    new Uint8Array(await file.arrayBuffer()),
  );
  checkpoint(operation);
  return { document, path: null, warnings: [] };
}
export async function openRecent(
  id: string,
  operation: string,
): Promise<Opened> {
  if (desktop) return invoke("open_recent", { id, operation });
  const browser = await import("./browser-files");
  const f = (await browser.records<Stored>("documents")).find(
    (d) => d.document.id === id,
  );
  if (!f) throw new Error("Recent document not found");
  return { document: f.document, path: f.path, warnings: [] };
}
export async function listRecent(): Promise<Recent[]> {
  if (desktop) return invoke("list_recent");
  const browser = await import("./browser-files");
  return (await browser.records<Stored>("documents"))
    .map(({ document: d, path }) => ({
      id: d.id,
      title: d.title,
      kind: d.content.kind,
      path,
      modifiedAt: d.modifiedAt,
      preview:
        d.content.kind === "writer"
          ? plainText(d.content.body).slice(0, 140)
          : "",
    }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
}
export async function saveFile(
  document: NexaDocument,
  saveAs: boolean,
  operation: string,
  format?: string,
): Promise<{ path: string; revision: number } | null> {
  if (desktop)
    return invoke("save_document", {
      document,
      saveAs,
      format: format ?? null,
      operation,
    });
  const browser = await import("./browser-files");
  const path = `${document.title}.${branding.nativeExtensions[document.content.kind]}`;
  const bytes = await browser.encodeNative(document);
  checkpoint(operation);
  await browser.put("documents", document.id, { document, path });
  browser.download(bytes, path);
  const recovery = (await browser.records<NexaDocument>("recovery")).find(
    (d) => d.id === document.id,
  );
  if (recovery && recovery.revision <= document.revision)
    await browser.remove("recovery", document.id);
  return { path, revision: document.revision };
}
export async function autosave(document: NexaDocument): Promise<void> {
  if (desktop) return invoke("autosave", { document });
  const browser = await import("./browser-files");
  return browser.put("recovery", document.id, document);
}
export async function listRecovery(): Promise<Recovery[]> {
  if (desktop) return invoke("list_recovery");
  const browser = await import("./browser-files");
  return (await browser.records<NexaDocument>("recovery")).map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.content.kind,
    modifiedAt: d.modifiedAt,
    revision: d.revision,
  }));
}
export async function restore(id: string): Promise<Opened> {
  if (desktop) return invoke("restore_recovery", { id });
  const browser = await import("./browser-files");
  const document = (await browser.records<NexaDocument>("recovery")).find(
    (d) => d.id === id,
  );
  if (!document) throw new Error("Recovery snapshot not found");
  return { document, path: null, warnings: [] };
}
export async function closeFile(id: string, discard: boolean): Promise<void> {
  if (desktop) return invoke("close_document", { id, discard });
  if (discard) {
    const browser = await import("./browser-files");
    await browser.remove("recovery", id);
  }
}
export async function discardRecovery(id: string): Promise<void> {
  if (desktop) return invoke("discard_recovery", { id });
  const browser = await import("./browser-files");
  await browser.remove("recovery", id);
}
export async function getSettings(): Promise<Settings> {
  if (desktop) return invoke("get_settings");
  const browser = await import("./browser-files");
  return { ...defaults, ...browser.readSettings() };
}
export async function setSettings(settings: Settings): Promise<void> {
  if (desktop) return invoke("set_settings", { settings });
  localStorage.setItem("nexa-settings", JSON.stringify(settings));
}
export async function readImageFile(
  file: File,
): Promise<{ src: string; width: number; height: number }> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 32 * 1024 * 1024
  )
    throw new Error("Image safety limit exceeded");
  const expected = imageDimensions(new Uint8Array(await file.arrayBuffer()));
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  if (width !== expected.width || height !== expected.height)
    throw new Error("Image dimensions exceed safety limits");
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  return { src, width, height };
}
export async function chooseImage(): Promise<{
  src: string;
  width: number;
  height: number;
} | null> {
  if (desktop) return invoke("choose_image");
  const browser = await import("./browser-files");
  const file = await browser.pickFile("image/png,image/jpeg,image/webp");
  return file ? readImageFile(file) : null;
}
export async function cancelOperation(operation: string): Promise<void> {
  if (desktop) await invoke("cancel_operation", { operation });
  else cancelled.add(operation);
}
export const operationId = uid;
