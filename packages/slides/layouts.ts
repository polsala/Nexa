import { blankSlide, object, type Slide } from "../editor-core/model";
import type { Translator } from "../i18n";
export type Layout =
  "title" | "content" | "section" | "blank" | "columns" | "image";
export function makeSlide(
  layout: Layout,
  t: Translator,
  number: number,
): Slide {
  const slide = blankSlide(`${t("slide")} ${number}`);
  if (layout === "blank") return slide;
  const title = object("text", t("slideTitle"));
  Object.assign(title, {
    x: 90,
    y: layout === "title" || layout === "section" ? 240 : 72,
    width: 1080,
    height: 150,
    fontSize: layout === "title" ? 72 : 54,
    bold: true,
  });
  slide.objects.push(title);
  if (layout === "section") {
    slide.background = "#183d33";
    title.color = "#ffffff";
    return slide;
  }
  const body = object("text", t("slideSubtitle"));
  Object.assign(body, {
    x: 96,
    y: layout === "title" ? 435 : 260,
    width: 1060,
    height: 250,
    fontSize: 30,
    color: "#5b7167",
  });
  if (layout === "columns") {
    body.width = 470;
    const second = {
      ...object("text", t("slideSubtitle")),
      x: 695,
      y: 260,
      width: 475,
      height: 250,
      fontSize: 30,
      color: "#5b7167",
    };
    slide.objects.push(second);
  }
  if (layout === "image") {
    body.width = 420;
    const shape = object("rectangle");
    Object.assign(shape, {
      x: 640,
      y: 245,
      width: 545,
      height: 340,
      fill: "#e0eade",
    });
    slide.objects.push(shape);
  }
  slide.objects.push(body);
  return slide;
}
