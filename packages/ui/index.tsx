import {
  useEffect,
  useRef,
  useState,
  useId,
  type ButtonHTMLAttributes,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignJustify,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Undo2,
  Redo2,
  FileText,
  Table2,
  Presentation,
  FolderOpen,
  Plus,
  X,
  Search,
  Settings2,
  Home,
  Clock3,
  LayoutTemplate,
  ShieldCheck,
  ChevronDown,
  Save,
  Printer,
  Download,
  Image,
  Link,
  Minus,
  Type,
  Square,
  Circle,
  Play,
  Copy,
  Trash2,
  MoreHorizontal,
  PanelRight,
  PanelLeft,
  ZoomIn,
  Check,
  Loader2,
  AlertTriangle,
  Palette,
  Grid2X2,
  ArrowDownToLine,
  ArrowUpToLine,
  IndentIncrease,
  IndentDecrease,
  BarChart3,
  Superscript,
  Subscript,
  Rows3,
  Columns3,
  Maximize2,
  RefreshCw,
  FilePlus2,
  type LucideIcon,
} from "lucide-react";
import type { Action } from "../editor-core/engine";
import type { Kind } from "../editor-core/model";
import type { Translator } from "../i18n";
const icons: Record<string, LucideIcon> = {
  arrowDown: ArrowDown,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  arrowUp: ArrowUp,
  arrowUpRight: ArrowUpRight,
  alignCenter: AlignCenter,
  alignLeft: AlignLeft,
  alignRight: AlignRight,
  justify: AlignJustify,
  bold: Bold,
  italic: Italic,
  underline: Underline,
  strike: Strikethrough,
  bullets: List,
  numbers: ListOrdered,
  undo: Undo2,
  redo: Redo2,
  writer: FileText,
  sheets: Table2,
  slides: Presentation,
  open: FolderOpen,
  plus: Plus,
  close: X,
  search: Search,
  settings: Settings2,
  home: Home,
  recent: Clock3,
  templates: LayoutTemplate,
  privacy: ShieldCheck,
  chevron: ChevronDown,
  save: Save,
  print: Printer,
  export: Download,
  image: Image,
  link: Link,
  minus: Minus,
  text: Type,
  rectangle: Square,
  ellipse: Circle,
  present: Play,
  duplicate: Copy,
  delete: Trash2,
  more: MoreHorizontal,
  inspector: PanelRight,
  outline: PanelLeft,
  zoom: ZoomIn,
  check: Check,
  loading: Loader2,
  warning: AlertTriangle,
  palette: Palette,
  grid: Grid2X2,
  back: ArrowDownToLine,
  front: ArrowUpToLine,
  indent: IndentIncrease,
  outdent: IndentDecrease,
  chart: BarChart3,
  superscript: Superscript,
  subscript: Subscript,
  row: Rows3,
  column: Columns3,
  fullscreen: Maximize2,
  recovery: RefreshCw,
  new: FilePlus2,
};
export function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const Component = icons[name] ?? Type;
  return (
    <Component
      size={size}
      strokeWidth={1.7}
      aria-hidden="true"
      className={className}
    />
  );
}
export function AppIcon({ kind, size = 36 }: { kind: Kind; size?: number }) {
  return (
    <span
      className={`app-icon ${kind}`}
      style={{ "--icon-size": `${size}px` } as CSSProperties}
    >
      <Icon name={kind} size={size * 0.55} />
    </span>
  );
}
export function Button({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`button ${className}`} {...props}>
      {children}
    </button>
  );
}
export function IconButton({
  label,
  icon,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: string }) {
  return (
    <Button
      aria-label={label}
      title={label}
      {...props}
      className={`icon-button ${props.className ?? ""}`}
    >
      <Icon name={icon} />
    </Button>
  );
}
export function ToolbarButton({
  action,
  t,
  execute,
}: {
  action: Action;
  t: Translator;
  execute: (a: Action) => void;
}) {
  return (
    <IconButton
      label={`${t(action.label)}${action.shortcut ? ` (${action.shortcut})` : ""}`}
      icon={action.icon ?? action.label}
      aria-pressed={action.active?.()}
      disabled={action.available?.() === false}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => execute(action)}
    />
  );
}
export function ToggleButton({
  active,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <Button {...props} aria-pressed={active}>
      {children}
    </Button>
  );
}
export function Dialog({
  title,
  children,
  close,
  className = "",
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <IconButton icon="close" label={title} onClick={close} />
      </div>
      {children}
    </dialog>
  );
}
export function Menu({
  label,
  children,
  icon,
  compact = false,
}: {
  label: string;
  children: ReactNode;
  icon?: string;
  compact?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (
        ref.current?.open &&
        e.target instanceof Node &&
        !ref.current.contains(e.target)
      )
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return (
    <details
      className="menu"
      ref={ref}
      onKeyDown={(e) => {
        const buttons = Array.from(
          ref.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? [],
        );
        if (e.key === "Escape" && ref.current) {
          ref.current.open = false;
          ref.current.querySelector("summary")?.focus();
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const i = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          buttons[
            (i + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
              buttons.length
          ]?.focus();
        }
      }}
    >
      <summary aria-label={label} title={label}>
        {icon && <Icon name={icon} />}
        {!compact && label}
        {!compact && <Icon name="chevron" size={12} />}
      </summary>
      <div
        className="menu-popover"
        role="menu"
        onClick={(e) => {
          if (
            e.target instanceof Element &&
            e.target.closest("button") &&
            ref.current
          )
            ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
export function MenuAction({
  action,
  t,
  execute,
}: {
  action: Action;
  t: Translator;
  execute: (a: Action) => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={action.available?.() === false}
      onClick={() => execute(action)}
    >
      <Icon name={action.icon ?? "arrowRight"} size={16} />
      <span>{t(action.label)}</span>
      {action.shortcut && <kbd>{action.shortcut}</kbd>}
    </button>
  );
}
export const fonts = [
  "Arial",
  "Arial Black",
  "Calibri",
  "Cambria",
  "Candara",
  "Carlito",
  "Courier New",
  "DejaVu Sans",
  "DejaVu Serif",
  "Georgia",
  "Liberation Sans",
  "Liberation Serif",
  "Noto Sans",
  "Noto Serif",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];
export function FontPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useRef(`fonts-${crypto.randomUUID()}`);
  return (
    <>
      <input
        className="font-picker"
        aria-label={label}
        list={id.current}
        defaultValue={value}
        onBlur={(e) => {
          if (e.currentTarget.value.trim())
            onChange(e.currentTarget.value.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onChange(e.currentTarget.value.trim());
        }}
      />
      <datalist id={id.current}>
        {fonts.map((font) => (
          <option key={font} value={font} />
        ))}
      </datalist>
    </>
  );
}
export function NumberInput({
  label,
  value,
  onChange,
  min = 0,
  max = 10000,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        type="number"
        value={Number(value.toFixed(2))}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(e) => {
          const n = e.currentTarget.valueAsNumber;
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
      />
    </label>
  );
}
export function ColourPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
}) {
  const colourListId = useId();
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("nexa-colours") ?? "[]",
      ) as string[];
    } catch {
      return [];
    }
  });
  const change = (v: string) => {
    onChange(v);
    const colors = [v, ...recent.filter((c) => c !== v)].slice(0, 8);
    setRecent(colors);
    localStorage.setItem("nexa-colours", JSON.stringify(colors));
  };
  return (
    <label className="colour-field" title={label}>
      <span>{label}</span>
      <input
        type="color"
        aria-label={label}
        value={/^#[a-f\d]{6}$/i.test(value) ? value : "#386b5a"}
        onChange={(e) => change(e.currentTarget.value)}
        list={colourListId}
      />
      <datalist id={colourListId}>
        {recent.map((c) => (
          <option value={c} key={c} />
        ))}
      </datalist>
    </label>
  );
}
export function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
export function EmptyState({
  icon,
  title,
  text,
  children,
}: {
  icon: string;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-illustration">
        <Icon name={icon} size={34} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function ProgressDialog({
  t,
  cancel,
}: {
  t: Translator;
  cancel: () => void;
}) {
  return (
    <Dialog title={t("processing")} close={cancel}>
      <div className="progress-body">
        <Icon name="loading" className="spin" size={30} />
        <progress aria-label={t("processing")} />
      </div>
      <div className="dialog-actions">
        <Button onClick={cancel}>{t("cancelOperation")}</Button>
      </div>
    </Dialog>
  );
}
export function StatusBar({ children }: { children: ReactNode }) {
  return <footer className="status-bar">{children}</footer>;
}
export function Toast({ text }: { text: string }) {
  return (
    <div role="status" className="toast">
      <Icon name="check" />
      {text}
    </div>
  );
}
