import { useState } from "react";
import { branding } from "../../../../packages/theme/branding";
import { AppIcon, Button, EmptyState, Icon } from "../../../../packages/ui";
import {
  templates,
  type Template,
} from "../../../../packages/editor-core/templates";
import type { Kind } from "../../../../packages/editor-core/model";
import type { Recent } from "../../../../packages/shell/files";
import type { Page } from "../../../../packages/shell/workspace";
import type { Translator } from "../../../../packages/i18n";
interface Props {
  t: Translator;
  page: Page;
  recent: Recent[];
  locale: string;
  create: (kind: Kind) => void;
  open: () => void;
  openRecent: (id: string) => void;
  template: (template: Template) => void;
}
export function Home({
  t,
  page,
  recent,
  locale,
  create,
  open,
  openRecent,
  template,
}: Props) {
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [query, setQuery] = useState("");
  const filtered = recent.filter(
    (f) =>
      (filter === "all" || filter === f.kind) &&
      `${f.title} ${f.path}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  });
  return (
    <main className="home-content">
      {page === "home" && (
        <>
          <section className="home-hero">
            <div>
              <span className="eyebrow">
                <span className="small-dot" />
                {t("localFirst")}
              </span>
              <h1>{t("greeting")}</h1>
              <p>{t("heroText")}</p>
              <Button className="primary" onClick={open}>
                <Icon name="open" />
                {t("open")}
                <kbd>Ctrl O</kbd>
              </Button>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="art-orbit" />
              <div className="art-sheet">
                <span className="art-bar" />
                <div className="art-grid" />
                <div className="art-chart">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <div className="art-paper">
                <span className="art-brand">N</span>
                <span className="art-heading" />
                <span className="art-line" />
                <span className="art-line" />
                <span className="art-line short" />
                <span className="art-block" />
                <span className="art-line" />
                <span className="art-line short" />
              </div>
              <span className="art-spark">✳</span>
            </div>
          </section>
          <div className="section-heading">
            <h2>{t("create")}</h2>
            <span>{t("startBlank")}</span>
          </div>
          <div className="create-cards">
            {(["writer", "sheets", "slides"] as const).map((kind, i) => (
              <button
                className={`create-card ${kind}`}
                key={kind}
                onClick={() => create(kind)}
              >
                <div className="create-card-top">
                  <AppIcon kind={kind} size={42} />
                  <Icon name="arrowUpRight" size={21} />
                </div>
                <h3>
                  {t(
                    (
                      [
                        "newDocument",
                        "newSpreadsheet",
                        "newPresentation",
                      ] as const
                    )[i] ?? "newDocument",
                  )}
                </h3>
                <p>
                  {t(
                    (
                      [
                        "writerDescription",
                        "sheetsDescription",
                        "slidesDescription",
                      ] as const
                    )[i] ?? "writerDescription",
                  )}
                </p>
                <span className="card-app-name">
                  {branding.shortName} {t(kind)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {page === "templates" ? (
        <>
          <div className="page-heading">
            <span className="eyebrow">{branding.shortName}</span>
            <h1>{t("templates")}</h1>
            <p>{t("templatesText")}</p>
          </div>
          <div className="template-grid">
            {templates.map((item, i) => (
              <button
                key={item.id}
                className={`template-card ${item.kind}`}
                onClick={() => template(item)}
              >
                <div
                  className={`template-preview variant-${i % 3}`}
                  aria-hidden="true"
                >
                  {item.kind === "writer" ? (
                    <div className="preview-document">
                      <span />
                      <i />
                      <i />
                      <i />
                      <b />
                      <i />
                      <i />
                      <i />
                    </div>
                  ) : item.kind === "sheets" ? (
                    <div className="preview-workbook">
                      <div />
                      {Array.from({ length: 5 }, (_, j) => (
                        <span key={j} />
                      ))}
                    </div>
                  ) : (
                    <div className="preview-slides">
                      <b />
                      <span />
                      <i />
                    </div>
                  )}
                </div>
                <div className="template-card-label">
                  <AppIcon kind={item.kind} size={26} />
                  <span>{t(item.label)}</span>
                  <Icon name="plus" size={16} />
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <section className="recent-section">
          <div className="section-heading">
            <div>
              <h2>{t("recent")}</h2>
              <p>{t("recentDescription")}</p>
            </div>
            <label className="search-field">
              <Icon name="search" size={17} />
              <input
                placeholder={t("search")}
                aria-label={t("search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <div className="filter-tabs" aria-label={t("fileType")}>
            {(["all", "writer", "sheets", "slides"] as const).map((kind) => (
              <button
                aria-pressed={filter === kind}
                key={kind}
                onClick={() => setFilter(kind)}
              >
                {t(kind)}
              </button>
            ))}
          </div>
          {filtered.length ? (
            <div className="recent-table">
              <div className="recent-table-header">
                <span>{t("name")}</span>
                <span>{t("location")}</span>
                <span>{t("modified")}</span>
              </div>
              {filtered.map((f) => (
                <button
                  className="recent-row"
                  key={f.id}
                  onClick={() => openRecent(f.id)}
                >
                  <span className="recent-file">
                    <AppIcon kind={f.kind} size={34} />
                    <span>
                      <strong>{f.title}</strong>
                      <small>
                        {t(f.kind)}
                        {f.preview ? ` · ${f.preview.slice(0, 50)}` : ""}
                      </small>
                    </span>
                  </span>
                  <span className="recent-path" title={f.path}>
                    {f.path}
                  </span>
                  <span>{date.format(f.modifiedAt)}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={recent.length ? "search" : "writer"}
              title={recent.length ? t("noMatches") : t("emptyRecent")}
              text={t("emptyRecentText")}
            >
              <Button onClick={open}>
                <Icon name="open" />
                {t("open")}
              </Button>
            </EmptyState>
          )}
        </section>
      )}
      <div className="home-footnote">
        <Icon name="privacy" size={14} />
        <span>{t("onDevice")}</span>
        <span>·</span>
        <span>
          {branding.shortName} {branding.version}
        </span>
      </div>
    </main>
  );
}
