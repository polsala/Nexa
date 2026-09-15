import type { RefObject } from "react";
import type { Deck, Slide, SlideObject } from "../editor-core/model";
import type { Translator } from "../i18n";
import { ColourPicker, FontPicker, NumberInput, InspectorSection } from "../ui";
interface Props {
  slide: Slide;
  selected?: SlideObject;
  selection: string[];
  setSelection: (ids: string[]) => void;
  stage: RefObject<HTMLDivElement | null>;
  updateObject: (values: Partial<SlideObject>, key?: string) => void;
  transact: (fn: (deck: Deck) => void, key?: string) => void;
  active: number;
  t: Translator;
}
export function SlideInspector({
  slide,
  selected,
  selection,
  setSelection,
  stage,
  updateObject,
  transact,
  active,
  t,
}: Props) {
  return (
    <aside className="inspector">
      <InspectorSection title={t("objects")}>
        <div className="object-list">
          {slide.objects.map((o, i) => (
            <button
              key={o.id}
              aria-pressed={selection.includes(o.id)}
              onClick={(e) => {
                setSelection(
                  e.shiftKey ? [...new Set([...selection, o.id])] : [o.id],
                );
                stage.current?.focus();
              }}
            >
              {i + 1} ·{" "}
              {o.text.slice(0, 36) || t(o.kind === "text" ? "textBox" : o.kind)}
            </button>
          ))}
        </div>
      </InspectorSection>
      {selected ? (
        <>
          <InspectorSection title={t("format")}>
            <FontPicker
              label={t("font")}
              value={selected.fontFamily}
              onChange={(fontFamily) => updateObject({ fontFamily })}
            />
            <NumberInput
              label={t("fontSize")}
              value={selected.fontSize}
              min={8}
              max={200}
              onChange={(fontSize) => updateObject({ fontSize })}
            />
            <ColourPicker
              label={t("textColor")}
              value={selected.color}
              onChange={(color) => updateObject({ color })}
            />
            <ColourPicker
              label={t("fill")}
              value={selected.fill}
              onChange={(fill) => updateObject({ fill })}
            />
            <ColourPicker
              label={t("stroke")}
              value={selected.stroke}
              onChange={(stroke) => updateObject({ stroke })}
            />
          </InspectorSection>
          <InspectorSection title={t("layout")}>
            {(
              [
                ["x", "positionX"],
                ["y", "positionY"],
                ["width", "width"],
                ["height", "height"],
                ["rotation", "rotate"],
              ] as const
            ).map(([key, label]) => (
              <NumberInput
                key={key}
                label={t(label)}
                value={selected[key]}
                min={key === "width" || key === "height" ? 20 : -2000}
                max={key === "rotation" ? 360 : 5000}
                onChange={(v) => updateObject({ [key]: v })}
              />
            ))}
          </InspectorSection>
        </>
      ) : (
        <InspectorSection title={t("slide")}>
          <label>
            {t("name")}
            <input
              value={slide.name}
              onChange={(e) => {
                const name = e.target.value;
                transact((d) => {
                  const s = d.slides[active];
                  if (s) s.name = name;
                }, "slide-name");
              }}
            />
          </label>
          <ColourPicker
            label={t("fill")}
            value={slide.background}
            onChange={(background) =>
              transact((d) => {
                const s = d.slides[active];
                if (s) s.background = background;
              })
            }
          />
        </InspectorSection>
      )}
    </aside>
  );
}
