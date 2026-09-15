import { isRecord, object, type SlideObject } from "../editor-core/model";
export const clipboardMime = "application/x-nexa-slide-objects+json";

/** Clipboard JSON is untrusted. Rebuild supported fields; never spread it into
 * the model, accept external image URLs, or retain identifiers from another deck. */
export function pasteObjects(payload: string): SlideObject[] {
  if (payload.length > 48 * 1024 * 1024)
    throw new Error("Clipboard size limit exceeded");
  const value: unknown = JSON.parse(payload);
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error("Invalid object clipboard");
  return value.map((v: unknown) => {
    if (
      !isRecord(v) ||
      !["text", "rectangle", "ellipse", "line", "arrow", "image"].includes(
        String(v.kind),
      )
    )
      throw new Error("Invalid clipboard object");
    const next = object(v.kind as SlideObject["kind"]);
    for (const key of [
      "x",
      "y",
      "width",
      "height",
      "rotation",
      "strokeWidth",
      "fontSize",
    ] as const) {
      const n = v[key];
      if (
        typeof n !== "number" ||
        !Number.isFinite(n) ||
        Math.abs(n) > 10000 ||
        (["width", "height", "fontSize"].includes(key) && n <= 0)
      )
        throw new Error("Invalid clipboard geometry");
      next[key] = n;
    }
    for (const key of [
      "text",
      "fontFamily",
      "fill",
      "stroke",
      "color",
      "align",
    ] as const) {
      if (typeof v[key] !== "string" || v[key].length > 1_000_000)
        throw new Error("Invalid clipboard text");
      next[key] = v[key];
    }
    next.bold = v.bold === true;
    next.italic = v.italic === true;
    if (next.kind === "image") {
      if (
        typeof v.src !== "string" ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.src)
      )
        throw new Error("Unsafe clipboard image");
      next.src = v.src;
    }
    // Preserve a bounded, text-only rich text tree, never arbitrary HTML.
    if (v.richText !== undefined) next.richText = readRichText(v.richText);
    next.x += 24;
    next.y += 24;
    return next;
  });
}
function readRichText(
  value: unknown,
  depth = 0,
): NonNullable<SlideObject["richText"]> {
  if (
    depth > 32 ||
    !isRecord(value) ||
    ![
      "doc",
      "paragraph",
      "text",
      "hardBreak",
      "bulletList",
      "orderedList",
      "listItem",
    ].includes(String(value.type))
  )
    throw new Error("Invalid clipboard rich text");
  return {
    type: String(value.type),
    ...(typeof value.text === "string" ? { text: value.text } : {}),
    ...(Array.isArray(value.content)
      ? { content: value.content.map((n) => readRichText(n, depth + 1)) }
      : {}),
    ...(Array.isArray(value.marks)
      ? {
          marks: value.marks
            .filter(isRecord)
            .filter((m) =>
              ["bold", "italic", "underline", "strike", "textStyle"].includes(
                String(m.type),
              ),
            )
            .map((m) => ({
              type: String(m.type),
              ...(isRecord(m.attrs)
                ? {
                    attrs: Object.fromEntries(
                      Object.entries(m.attrs).filter(
                        ([k, v]) =>
                          ["color", "fontFamily", "fontSize"].includes(k) &&
                          typeof v === "string",
                      ),
                    ),
                  }
                : {}),
            })),
        }
      : {}),
  };
}
export function distribute(
  objects: SlideObject[],
  ids: string[],
  axis: "x" | "y",
): void {
  const size = axis === "x" ? "width" : "height";
  const selected = objects
    .filter((o) => ids.includes(o.id))
    .sort((a, b) => a[axis] - b[axis]);
  if (selected.length < 3) return;
  const first = selected[0];
  const last = selected.at(-1);
  if (!first || !last) return;
  const gap =
    (last[axis] +
      last[size] -
      first[axis] -
      selected.reduce((n, o) => n + o[size], 0)) /
    (selected.length - 1);
  let position = first[axis];
  for (const o of selected) {
    o[axis] = position;
    position += o[size] + gap;
  }
}
