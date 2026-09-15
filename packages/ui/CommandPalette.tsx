import { useMemo, useState } from "react";
import { Dialog, Icon } from "./index";
import type { Action } from "../editor-core/engine";
import type { Translator } from "../i18n";
export function CommandPalette({
  actions,
  t,
  close,
  execute,
}: {
  actions: Action[];
  t: Translator;
  close: () => void;
  execute: (a: Action) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const results = useMemo(
    () =>
      actions.filter(
        (a) =>
          a.available?.() !== false &&
          `${t(a.label)} ${a.id}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [actions, t, query],
  );
  return (
    <Dialog
      title={t("commandPalette")}
      close={close}
      className="palette-dialog"
    >
      <div className="palette-input">
        <Icon name="search" />
        <input
          autoFocus
          placeholder={t("searchCommands")}
          aria-label={t("searchCommands")}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={
            results[selected] ? `command-${selected}` : undefined
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) => Math.min(results.length - 1, i + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(0, i - 1));
            }
            if (e.key === "Enter" && results[selected]) {
              e.preventDefault();
              close();
              execute(results[selected]);
            }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <div className="palette-results" id="command-results" role="listbox">
        {results.map((action, i) => (
          <button
            key={action.id}
            id={`command-${i}`}
            role="option"
            aria-selected={selected === i}
            className={selected === i ? "selected" : ""}
            onMouseMove={() => setSelected(i)}
            onClick={() => {
              close();
              execute(action);
            }}
          >
            <Icon name={action.icon ?? "arrowRight"} />
            <span>{t(action.label)}</span>
            {action.shortcut && <kbd>{action.shortcut}</kbd>}
          </button>
        ))}
        {!results.length && <p>{t("noCommands")}</p>}
      </div>
    </Dialog>
  );
}
