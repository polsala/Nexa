import {
  newDocument,
  paragraph,
  object,
  blankSlide,
  type Kind,
  type NexaDocument,
} from "./model";
import type { MessageKey, Translator } from "../i18n";
export interface Template {
  id: string;
  kind: Kind;
  label: MessageKey;
}
export const templates: Template[] = [
  { id: "blank-doc", kind: "writer", label: "blankDoc" },
  { id: "letter", kind: "writer", label: "letter" },
  { id: "report", kind: "writer", label: "report" },
  { id: "blank-book", kind: "sheets", label: "blankBook" },
  { id: "budget", kind: "sheets", label: "budget" },
  { id: "data-table", kind: "sheets", label: "dataTable" },
  { id: "blank-deck", kind: "slides", label: "blankDeck" },
  { id: "pitch", kind: "slides", label: "pitch" },
  { id: "project-update", kind: "slides", label: "projectUpdate" },
];
export function makeTemplate(template: Template, t: Translator): NexaDocument {
  const d = newDocument(template.kind, t(template.label));
  if (d.content.kind === "writer") {
    if (template.id === "letter")
      d.content.body.content = [
        paragraph(t("templateLetterTitle"), "heading"),
        ...t("templateLetterBody")
          .split("\n")
          .map((line) => paragraph(line)),
      ];
    if (template.id === "report")
      d.content.body.content = [
        paragraph(t("templateReportTitle"), "heading"),
        {
          ...paragraph(t("templateReportIntro"), "heading"),
          attrs: { level: 2 },
        },
        paragraph(t("templateReportBody")),
        {
          ...paragraph(t("templateReportNext"), "heading"),
          attrs: { level: 2 },
        },
        paragraph(t("templateReportNextBody")),
      ];
  }
  if (d.content.kind === "sheets") {
    const sheet = d.content.workbook.sheets[0];
    if (sheet && template.id === "budget") {
      sheet.name = t("budget");
      sheet.freeze = [1, 0];
      [t("category"), t("planned"), t("actual"), t("difference")].forEach(
        (value, c) => {
          (sheet.cells[0] ??= {})[c] = {
            value,
            format: { bold: true, color: "#ffffff", background: "#386b5a" },
          };
        },
      );
      (
        ["housing", "food", "transport", "utilities", "leisure"] as const
      ).forEach((key, i) => {
        const r = i + 1;
        sheet.cells[r] = {
          0: { value: t(key) },
          1: {
            value: [1200, 350, 120, 150, 200][i] ?? 0,
            format: { numberFormat: "#,##0.00" },
          },
          2: {
            value: [1200, 320, 95, 142, 175][i] ?? 0,
            format: { numberFormat: "#,##0.00" },
          },
          3: {
            value: null,
            formula: `=B${r + 1}-C${r + 1}`,
            format: { numberFormat: "#,##0.00" },
          },
        };
      });
      sheet.cells[6] = {
        0: { value: t("total"), format: { bold: true } },
        1: { value: null, formula: "=SUM(B2:B6)", format: { bold: true } },
        2: { value: null, formula: "=SUM(C2:C6)", format: { bold: true } },
        3: { value: null, formula: "=B7-C7", format: { bold: true } },
      };
      sheet.columnDimensions = {
        0: { w: 190 },
        1: { w: 130 },
        2: { w: 130 },
        3: { w: 130 },
      };
    } else if (sheet && template.id === "data-table") {
      [t("item"), t("quantity"), t("price"), t("total")].forEach((value, c) => {
        (sheet.cells[0] ??= {})[c] = {
          value,
          format: { bold: true, background: "#e4eee6" },
        };
      });
      sheet.cells[1] = {
        0: { value: t("item") + " 1" },
        1: { value: 5 },
        2: { value: 12 },
        3: { value: null, formula: "=B2*C2" },
      };
    }
  }
  if (d.content.kind === "slides" && !template.id.startsWith("blank")) {
    const titles =
      template.id === "pitch"
        ? [
            t("slideTitle"),
            t("opportunity"),
            t("solution"),
            t("nextSteps"),
            t("questions"),
          ]
        : [t("projectUpdate"), t("progress"), t("nextSteps")];
    d.content.deck.slides = titles.map((title, i) => {
      const slide = blankSlide(title);
      slide.background = i === 0 ? "#183d33" : "#f8f7f2";
      const titleObject = object("text", title);
      Object.assign(titleObject, {
        x: 90,
        y: i === 0 ? 250 : 90,
        width: 1040,
        height: 150,
        fontSize: i === 0 ? 76 : 52,
        bold: true,
        color: i === 0 ? "#f9f8ef" : "#183d33",
      });
      const subtitle = object("text", t("slideSubtitle"));
      Object.assign(subtitle, {
        x: 95,
        y: i === 0 ? 450 : 275,
        fontSize: 28,
        color: i === 0 ? "#bed4c7" : "#64766d",
        width: 1000,
      });
      const accent = object("rectangle");
      Object.assign(accent, {
        x: 95,
        y: 70,
        width: 65,
        height: 8,
        fill: "#b9d7a6",
      });
      slide.objects = [accent, titleObject, subtitle];
      return slide;
    });
  }
  return d;
}
