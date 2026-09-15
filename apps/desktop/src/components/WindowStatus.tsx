import { branding } from "../../../../packages/theme/branding";
import type { Session } from "../../../../packages/shell/workspace";
import { workspace } from "../../../../packages/shell/workspace";
import * as files from "../../../../packages/shell/files";
import type { Translator } from "../../../../packages/i18n";
import { AppIcon, Icon, IconButton, StatusBar } from "../../../../packages/ui";
export function WindowStatus({
  active,
  count,
  characterCount,
  locale,
  t,
}: {
  active?: Session;
  count: number;
  characterCount?: number;
  locale: string;
  t: Translator;
}) {
  return (
    <StatusBar>
      {active ? (
        <>
          <span className="status-kind">
            <AppIcon kind={active.document.content.kind} size={18} />
            {t(active.document.content.kind)}
          </span>
          <span title={t("statistics")}>
            {new Intl.NumberFormat(locale).format(count)}{" "}
            {t(
              active.document.content.kind === "writer"
                ? "words"
                : active.document.content.kind === "sheets"
                  ? "cells"
                  : "slides",
            )}
            {characterCount !== undefined && (
              <>
                {" "}
                · {new Intl.NumberFormat(locale).format(characterCount)}{" "}
                {t("characters")}
              </>
            )}
          </span>
          <span className="save-status">
            <span className={`small-dot ${active.dirty ? "warning" : ""}`} />
            {t(active.dirty ? "unsaved" : "allSaved")}
          </span>
          <div className="toolbar-spacer" />
          <IconButton
            label={t("zoom")}
            icon="minus"
            onClick={() => {
              active.zoom = Math.max(40, active.zoom - 10);
              workspace.refresh();
            }}
          />
          <input
            aria-label={t("zoom")}
            className="zoom-slider"
            type="range"
            min="40"
            max="200"
            step="5"
            value={active.zoom}
            onChange={(e) => {
              active.zoom = Number(e.target.value);
              workspace.refresh();
            }}
          />
          <IconButton
            label={t("zoom")}
            icon="plus"
            onClick={() => {
              active.zoom = Math.min(200, active.zoom + 10);
              workspace.refresh();
            }}
          />
          <button
            className="zoom-value"
            onClick={() => {
              active.zoom = 100;
              workspace.refresh();
            }}
          >
            {active.zoom}%
          </button>
        </>
      ) : (
        <>
          <Icon name="privacy" size={13} />
          <span>{t("ready")}</span>
          <div className="toolbar-spacer" />
          <span>{files.desktop ? branding.name : t("browserNote")}</span>
        </>
      )}
    </StatusBar>
  );
}
