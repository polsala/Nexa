import {
  useEffect,
  useRef,
  useState,
  memo,
  type PointerEvent,
  type CSSProperties,
  type ClipboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type {
  Content,
  Deck,
  SlideObject,
  TextNode,
} from "../editor-core/model";
import { object, uid } from "../editor-core/model";
import { History } from "../editor-core/history";
import { replaceText } from "../editor-core/search";
import { clipboardMime, pasteObjects, distribute } from "./operations";
import type { Action, EditorEngine, EditorHost } from "../editor-core/engine";
import type { Translator } from "../i18n";
import { Button, Icon, IconButton } from "../ui";
import { readImageFile } from "../shell/files";
import { makeSlide, type Layout } from "./layouts";
import { SlideCanvas } from "./SlideCanvas";
import { SlideTextEditor } from "./SlideTextEditor";
import { SlideInspector } from "./SlideInspector";
interface Props {
  content: Extract<Content, { kind: "slides" }>;
  host: EditorHost;
  t: Translator;
  zoom: number;
  inspector: boolean;
}
interface Drag {
  pointer: number;
  startX: number;
  startY: number;
  ids: string[];
  resize: boolean;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
  guideX?: number;
  guideY?: number;
  object: SlideObject;
}
function Slides({ content, host, t, zoom, inspector }: Props) {
  const [initialHistory] = useState(() => new History(content.deck));
  const history = useRef(initialHistory);
  const [deck, setDeck] = useState(content.deck);
  const [active, setActive] = useState(0);
  const activeRef = useRef(active);
  const [selection, setSelection] = useState<string[]>([]);
  const selectionRef = useRef(selection);
  const [layout, setLayout] = useState<Layout>("title");
  const layoutRef = useRef(layout);
  const [grid, setGrid] = useState(false);
  const [snap, setSnap] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  const [presenterNotes, setPresenterNotes] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.65);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const dragSlide = useRef<number | null>(null);
  const initial = useRef({ host, t });
  activeRef.current = active;
  selectionRef.current = selection;
  layoutRef.current = layout;
  const slide = deck.slides[Math.min(active, deck.slides.length - 1)];
  const selected = slide?.objects.find((o) => selection.includes(o.id));
  const scale = (fit * zoom) / 100;
  function changed(next: Deck) {
    setDeck(next);
    host.changed();
    host.selectionChanged();
  }
  function transact(fn: (draft: Deck) => void, key = "") {
    changed(history.current.transact(fn, key));
  }
  function updateObject(values: Partial<SlideObject>, key = "") {
    transact((d) => {
      for (const o of d.slides[activeRef.current]?.objects ?? [])
        if (selectionRef.current.includes(o.id)) Object.assign(o, values);
    }, key);
  }
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const resize = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setFit(Math.min(1, Math.max(0.2, (box.width - 70) / 1280)));
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    const { host, t } = initial.current;
    const commit = (fn: (d: Deck) => void, key = "") => {
      const next = history.current.transact(fn, key);
      setDeck(next);
      host.changed();
      host.selectionChanged();
    };
    const update = (values: Partial<SlideObject>) =>
      commit((d) => {
        for (const o of d.slides[activeRef.current]?.objects ?? [])
          if (selectionRef.current.includes(o.id)) Object.assign(o, values);
      });
    const add = (kind: SlideObject["kind"]) => {
      const next = object(kind, kind === "text" ? t("textPlaceholder") : "");
      commit((d) => {
        d.slides[activeRef.current]?.objects.push(next);
      });
      setSelection([next.id]);
    };
    const duplicateSlide = () => {
      commit((d) => {
        const original = d.slides[activeRef.current];
        if (!original) return;
        const copy = structuredClone(original);
        copy.id = uid();
        copy.objects.forEach((o) => {
          o.id = uid();
        });
        d.slides.splice(activeRef.current + 1, 0, copy);
      });
      setActive((a) => a + 1);
    };
    const duplicateObject = () => {
      const ids: string[] = [];
      commit((d) => {
        const s = d.slides[activeRef.current];
        if (!s) return;
        const copies = s.objects
          .filter((o) => selectionRef.current.includes(o.id))
          .map((o) => ({
            ...structuredClone(o),
            id: uid(),
            x: o.x + 24,
            y: o.y + 24,
          }));
        s.objects.push(...copies);
        ids.push(...copies.map((o) => o.id));
      });
      setSelection(ids);
    };
    const arrange = (direction: "forward" | "backward" | "front" | "back") =>
      commit((d) => {
        const s = d.slides[activeRef.current];
        if (!s) return;
        for (const id of selectionRef.current) {
          const i = s.objects.findIndex((o) => o.id === id);
          if (i < 0) continue;
          const [o] = s.objects.splice(i, 1);
          if (!o) continue;
          const target =
            direction === "front"
              ? s.objects.length
              : direction === "back"
                ? 0
                : direction === "forward"
                  ? Math.min(s.objects.length, i + 1)
                  : Math.max(0, i - 1);
          s.objects.splice(target, 0, o);
        }
      });
    const actions: Action[] = [
      {
        id: "slides.addSlide",
        label: "addSlide",
        icon: "plus",
        execute: () => {
          commit((d) =>
            d.slides.splice(
              activeRef.current + 1,
              0,
              makeSlide(layoutRef.current, t, d.slides.length + 1),
            ),
          );
          setActive((a) => a + 1);
          setSelection([]);
        },
      },
      {
        id: "slides.duplicateSlide",
        label: "duplicateSlide",
        icon: "duplicate",
        execute: duplicateSlide,
      },
      {
        id: "slides.deleteSlide",
        label: "deleteSlide",
        icon: "delete",
        available: () => history.current.value.slides.length > 1,
        execute: () => {
          commit((d) => {
            d.slides.splice(activeRef.current, 1);
          });
          setActive((a) => Math.max(0, a - 1));
          setSelection([]);
        },
      },
      ...(["text", "rectangle", "ellipse", "line", "arrow"] as const).map(
        (kind) => ({
          id: `slides.insert.${kind}`,
          label: kind === "text" ? ("textBox" as const) : kind,
          icon:
            kind === "line" ? "minus" : kind === "arrow" ? "arrowRight" : kind,
          execute: () => add(kind),
        }),
      ),
      {
        id: "slides.image",
        label: "image",
        icon: "image",
        execute: async () => {
          const img = await host.image();
          if (img) {
            const o = object("image");
            Object.assign(o, {
              src: img.src,
              width: Math.min(700, img.width),
              height: (Math.min(700, img.width) * img.height) / img.width,
            });
            commit((d) => d.slides[activeRef.current]?.objects.push(o));
            setSelection([o.id]);
          }
        },
      },
      {
        id: "slides.deleteObject",
        label: "deleteObject",
        icon: "delete",
        available: () => selectionRef.current.length > 0,
        execute: () => {
          commit((d) => {
            const s = d.slides[activeRef.current];
            if (s)
              s.objects = s.objects.filter(
                (o) => !selectionRef.current.includes(o.id),
              );
          });
          setSelection([]);
        },
      },
      {
        id: "slides.duplicateObject",
        label: "duplicateObject",
        icon: "duplicate",
        available: () => selectionRef.current.length > 0,
        execute: duplicateObject,
      },
      ...(["forward", "backward", "front", "back"] as const).map(
        (direction, i) => ({
          id: `slides.arrange.${direction}`,
          label:
            (
              [
                "bringForward",
                "sendBackward",
                "bringFront",
                "sendBack",
              ] as const
            )[i] ?? "bringForward",
          icon: direction === "back" ? "back" : "front",
          available: () => selectionRef.current.length > 0,
          execute: () => arrange(direction),
        }),
      ),
      ...(["left", "center", "right"] as const).map((align, i) => ({
        id: `slides.align.${align}`,
        label:
          (["alignLeft", "alignCenter", "alignRight"] as const)[i] ??
          "alignLeft",
        icon: (["alignLeft", "alignCenter", "alignRight"] as const)[i],
        available: () => selectionRef.current.length > 0,
        execute: () =>
          commit((d) => {
            for (const o of d.slides[activeRef.current]?.objects ?? [])
              if (selectionRef.current.includes(o.id))
                o.x =
                  align === "left"
                    ? 80
                    : align === "center"
                      ? (d.width - o.width) / 2
                      : d.width - o.width - 80;
          }),
      })),
      ...(["x", "y"] as const).map((axis) => ({
        id: `slides.distribute.${axis}`,
        label:
          axis === "x"
            ? ("distributeHorizontal" as const)
            : ("distributeVertical" as const),
        icon: "layout",
        available: () => selectionRef.current.length >= 3,
        execute: () =>
          commit((d) =>
            distribute(
              d.slides[activeRef.current]?.objects ?? [],
              selectionRef.current,
              axis,
            ),
          ),
      })),
      {
        id: "slides.bold",
        label: "bold",
        icon: "bold",
        execute: () => {
          const o = history.current.value.slides[
            activeRef.current
          ]?.objects.find((o) => selectionRef.current.includes(o.id));
          if (o) update({ bold: !o.bold });
        },
      },
      {
        id: "slides.italic",
        label: "italic",
        icon: "italic",
        execute: () => {
          const o = history.current.value.slides[
            activeRef.current
          ]?.objects.find((o) => selectionRef.current.includes(o.id));
          if (o) update({ italic: !o.italic });
        },
      },
      {
        id: "slides.present",
        label: "present",
        icon: "present",
        shortcut: "F5",
        execute: () => {
          setEditing(null);
          setPresenting(true);
          void document.documentElement.requestFullscreen?.().catch(() => {});
        },
      },
    ];
    const engine: EditorEngine = {
      kind: "slides",
      actions,
      snapshot: () => ({ kind: "slides", deck: history.current.value }),
      undo: () => {
        const next = history.current.undo();
        setDeck(next);
        setActive((a) => Math.min(a, next.slides.length - 1));
        setSelection([]);
        setEditing(null);
        host.changed();
        host.selectionChanged();
      },
      redo: () => {
        const next = history.current.redo();
        setDeck(next);
        setActive((a) => Math.min(a, next.slides.length - 1));
        setSelection([]);
        setEditing(null);
        host.changed();
        host.selectionChanged();
      },
      focus: () => stage.current?.focus(),
      setZoom: () => {},
      getText: () => String(history.current.value.slides.length),
      find: (query, replacement) => {
        let count = 0;
        let first = true;
        const change = (d: Deck) => {
          for (const [i, s] of d.slides.entries())
            for (const o of s.objects) {
              if (
                !query ||
                !o.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())
              )
                continue;
              count++;
              if (first) {
                setActive(i);
                setSelection([o.id]);
                first = false;
              }
              if (replacement !== undefined) {
                o.text = replaceText(o.text, query, replacement);
                o.richText = undefined;
              }
            }
        };
        if (replacement !== undefined) commit(change);
        else change(history.current.value);
        return count;
      },
      dispose: () => {},
    };
    host.ready(engine);
  }, []);
  useEffect(() => {
    if (!presenting) return;
    const exit = () => {
      setPresenting(false);
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => {});
    };
    const key = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", " ", "PageDown"].includes(e.key)) {
        e.preventDefault();
        setActive((a) => Math.min(deck.slides.length - 1, a + 1));
      } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === "Escape") exit();
      else if (e.key.toLowerCase() === "n") setPresenterNotes((n) => !n);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [presenting, deck.slides.length]);
  function pointerDown(
    e: PointerEvent<SVGGElement>,
    o: SlideObject,
    resize: boolean,
  ) {
    if (editing) return;
    e.preventDefault();
    e.stopPropagation();
    const ids = e.shiftKey
      ? [...new Set([...selection, o.id])]
      : selection.includes(o.id)
        ? selection
        : [o.id];
    setSelection(ids);
    e.currentTarget.setPointerCapture(e.pointerId);
    const value: Drag = {
      pointer: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      ids,
      resize,
      dx: 0,
      dy: 0,
      dw: 0,
      dh: 0,
      object: o,
    };
    dragRef.current = value;
    setDrag(value);
    stage.current?.focus();
  }
  function pointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || d.pointer !== e.pointerId) return;
    let dx = (e.clientX - d.startX) / scale;
    let dy = (e.clientY - d.startY) / scale;
    if (snap && !e.altKey) {
      dx = Math.round((d.object.x + dx) / 8) * 8 - d.object.x;
      dy = Math.round((d.object.y + dy) / 8) * 8 - d.object.y;
    }
    const next = {
      ...d,
      dx: d.resize ? 0 : dx,
      dy: d.resize ? 0 : dy,
      dw: d.resize ? dx : 0,
      dh: d.resize ? dy : 0,
      guideX: undefined as number | undefined,
      guideY: undefined as number | undefined,
    };
    if (
      !d.resize &&
      Math.abs(d.object.x + dx + d.object.width / 2 - deck.width / 2) < 8
    ) {
      next.dx = (deck.width - d.object.width) / 2 - d.object.x;
      next.guideX = deck.width / 2;
    }
    if (
      !d.resize &&
      Math.abs(d.object.y + dy + d.object.height / 2 - deck.height / 2) < 8
    ) {
      next.dy = (deck.height - d.object.height) / 2 - d.object.y;
      next.guideY = deck.height / 2;
    }
    dragRef.current = next;
    setDrag(next);
  }
  function pointerUp() {
    const d = dragRef.current;
    if (!d) return;
    if (d.dx || d.dy || d.dw || d.dh)
      transact((deck) => {
        for (const o of deck.slides[activeRef.current]?.objects ?? [])
          if (d.ids.includes(o.id)) {
            o.x += d.dx;
            o.y += d.dy;
            o.width = Math.max(20, o.width + d.dw);
            o.height = Math.max(20, o.height + d.dh);
          }
      });
    dragRef.current = null;
    setDrag(null);
  }
  function copy(e: ClipboardEvent<HTMLDivElement>, cut: boolean) {
    if (editing || !selection.length) return;
    const objects =
      slide?.objects.filter((o) => selection.includes(o.id)) ?? [];
    e.clipboardData.setData(clipboardMime, JSON.stringify(objects));
    e.clipboardData.setData(
      "text/plain",
      objects.map((o) => o.text).join("\n"),
    );
    e.preventDefault();
    if (cut) {
      transact((d) => {
        const s = d.slides[activeRef.current];
        if (s)
          s.objects = s.objects.filter(
            (o) => !selectionRef.current.includes(o.id),
          );
      });
      setSelection([]);
    }
  }
  async function insertImage(file: File) {
    const img = await readImageFile(file);
    const o = object("image");
    Object.assign(o, {
      src: img.src,
      width: Math.min(600, img.width),
      height: (Math.min(600, img.width) * img.height) / img.width,
    });
    transact((d) => d.slides[activeRef.current]?.objects.push(o));
    setSelection([o.id]);
  }
  if (!slide) return null;
  return (
    <div className="slides-layout">
      <aside className="slide-navigator">
        <div className="navigator-heading">
          <span>{t("slides")}</span>
          <span>{deck.slides.length}</span>
        </div>
        <select
          aria-label={t("layout")}
          value={layout}
          onChange={(e) => setLayout(e.target.value as Layout)}
        >
          {(
            [
              "title",
              "content",
              "section",
              "blank",
              "columns",
              "image",
            ] as const
          ).map((k) => (
            <option key={k} value={k}>
              {t(`${k}Layout`)}
            </option>
          ))}
        </select>
        {deck.slides.map((s, i) => (
          <button
            key={s.id}
            className={`slide-thumbnail ${active === i ? "active" : ""}`}
            aria-label={`${t("slide")} ${i + 1}`}
            aria-current={active === i ? "page" : undefined}
            draggable
            onDragStart={() => {
              dragSlide.current = i;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragSlide.current;
              if (from !== null && from !== i) {
                transact((d) => {
                  const [s] = d.slides.splice(from, 1);
                  if (s) d.slides.splice(i, 0, s);
                });
                setActive(i);
              }
              dragSlide.current = null;
            }}
            onClick={() => {
              setActive(i);
              setSelection([]);
              setEditing(null);
            }}
          >
            <span>{i + 1}</span>
            <SlideCanvas slide={s} width={deck.width} height={deck.height} />
          </button>
        ))}
        <div className="navigator-controls">
          <IconButton
            label={t("moveUp")}
            icon="arrowUp"
            disabled={active === 0}
            onClick={() => {
              transact((d) => {
                const [s] = d.slides.splice(active, 1);
                if (s) d.slides.splice(active - 1, 0, s);
              });
              setActive((a) => a - 1);
            }}
          />
          <IconButton
            label={t("moveDown")}
            icon="arrowDown"
            disabled={active === deck.slides.length - 1}
            onClick={() => {
              transact((d) => {
                const [s] = d.slides.splice(active, 1);
                if (s) d.slides.splice(active + 1, 0, s);
              });
              setActive((a) => a + 1);
            }}
          />
        </div>
      </aside>
      <div className="slide-workspace">
        <div
          ref={stage}
          className="slide-stage"
          tabIndex={0}
          aria-label={t("slides")}
          onCopy={(e) => copy(e, false)}
          onCut={(e) => copy(e, true)}
          onPaste={(e) => {
            if (editing) return;
            const payload = e.clipboardData.getData(clipboardMime);
            const image = Array.from(e.clipboardData.files).find((f) =>
              f.type.startsWith("image/"),
            );
            const text = e.clipboardData.getData("text/plain");
            if (!payload && !image && !text) return;
            e.preventDefault();
            if (image) {
              void insertImage(image).catch(host.error);
              return;
            }
            try {
              const copies = payload
                ? pasteObjects(payload)
                : [object("text", text.slice(0, 1_000_000))];
              transact((d) =>
                d.slides[activeRef.current]?.objects.push(...copies),
              );
              setSelection(copies.map((o) => o.id));
            } catch (error) {
              host.error(error);
            }
          }}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
            setDrag(null);
          }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) {
              setSelection([]);
              setEditing(null);
            }
          }}
          onKeyDown={(e) => {
            if (
              e.target instanceof HTMLElement &&
              (e.target.isContentEditable || e.target.tagName === "INPUT")
            )
              return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
              e.preventDefault();
              setSelection(slide.objects.map((o) => o.id));
            }
            if (
              e.key === "Enter" &&
              selected &&
              ["text", "rectangle"].includes(selected.kind)
            ) {
              e.preventDefault();
              setEditing(selected.id);
            }
            if (e.key === "Escape") setSelection([]);
            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              ) &&
              selection.length
            ) {
              e.preventDefault();
              const amount = e.shiftKey ? 10 : 1;
              transact((d) => {
                for (const o of d.slides[active]?.objects ?? [])
                  if (selection.includes(o.id)) {
                    o.x +=
                      e.key === "ArrowLeft"
                        ? -amount
                        : e.key === "ArrowRight"
                          ? amount
                          : 0;
                    o.y +=
                      e.key === "ArrowUp"
                        ? -amount
                        : e.key === "ArrowDown"
                          ? amount
                          : 0;
                  }
              }, "nudge");
            }
            if (
              (e.key === "Delete" || e.key === "Backspace") &&
              selection.length
            ) {
              e.preventDefault();
              transact((d) => {
                const s = d.slides[active];
                if (s)
                  s.objects = s.objects.filter(
                    (o) => !selection.includes(o.id),
                  );
              });
              setSelection([]);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const f = e.dataTransfer.files[0];
            if (!f?.type.startsWith("image/")) return;
            e.preventDefault();
            void insertImage(f).catch(host.error);
          }}
        >
          <div
            className="slide-size"
            style={{ width: deck.width * scale, height: deck.height * scale }}
          >
            <div
              className="slide-canvas-wrap"
              style={{
                width: deck.width,
                height: deck.height,
                transform: `scale(${scale})`,
              }}
            >
              <SlideCanvas
                slide={slide}
                width={deck.width}
                height={deck.height}
                selected={selection}
                onPointerDown={pointerDown}
                onDoubleClick={(o) => {
                  if (o.kind === "text" || o.kind === "rectangle") {
                    setSelection([o.id]);
                    setEditing(o.id);
                  }
                }}
                preview={drag ?? undefined}
                grid={grid}
                guideX={drag?.guideX}
                guideY={drag?.guideY}
              />
              {editing && selected?.id === editing && (
                <div
                  className="slide-edit-overlay"
                  style={{
                    left: selected.x,
                    top: selected.y,
                    width: selected.width,
                    minHeight: selected.height,
                    transform: `rotate(${selected.rotation}deg)`,
                  }}
                >
                  <SlideTextEditor
                    key={selected.id}
                    object={selected}
                    t={t}
                    change={(text: string, richText: TextNode) =>
                      updateObject({ text, richText }, `text-${selected.id}`)
                    }
                    finish={() => setEditing(null)}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="slide-options">
          <label>
            <input
              type="checkbox"
              checked={grid}
              onChange={(e) => setGrid(e.target.checked)}
            />
            {t("grid")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => setSnap(e.target.checked)}
            />
            {t("snap")}
          </label>
        </div>
        <label className="speaker-notes">
          <span>
            <Icon name="text" size={16} />
            {t("notes")}
          </span>
          <textarea
            aria-label={t("notes")}
            value={slide.notes}
            placeholder={t("notesPlaceholder")}
            onChange={(e) => {
              const value = e.target.value;
              transact((d) => {
                const s = d.slides[active];
                if (s) s.notes = value;
              }, `notes-${slide.id}`);
            }}
          />
        </label>
      </div>
      {inspector && (
        <SlideInspector
          slide={slide}
          selected={selected}
          selection={selection}
          setSelection={setSelection}
          stage={stage}
          updateObject={updateObject}
          transact={transact}
          active={active}
          t={t}
        />
      )}
      {presenting &&
        createPortal(
          <div
            className="slideshow"
            role="dialog"
            aria-modal="true"
            aria-label={t("present")}
            style={
              {
                "--slide-ratio": `${deck.width}/${deck.height}`,
              } as CSSProperties
            }
          >
            <div className="slideshow-canvas">
              <SlideCanvas
                slide={slide}
                width={deck.width}
                height={deck.height}
              />
            </div>
            {presenterNotes && (
              <aside className="presenter-notes">
                <h3>{t("notes")}</h3>
                <p>{slide.notes}</p>
              </aside>
            )}
            <div className="slideshow-controls">
              <IconButton
                label={t("previousSlide")}
                icon="arrowLeft"
                disabled={active === 0}
                onClick={() => setActive((a) => a - 1)}
              />
              <span>
                {active + 1} {t("of")} {deck.slides.length}
              </span>
              <IconButton
                label={t("nextSlide")}
                icon="arrowRight"
                disabled={active === deck.slides.length - 1}
                onClick={() => setActive((a) => a + 1)}
              />
              <Button onClick={() => setPresenterNotes((n) => !n)}>
                {t("notes")}
              </Button>
              <span>{t("presentationHint")}</span>
              <IconButton
                label={t("exitPresentation")}
                icon="close"
                onClick={() => {
                  setPresenting(false);
                  if (document.fullscreenElement)
                    void document.exitFullscreen().catch(host.error);
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
export default memo(Slides);
