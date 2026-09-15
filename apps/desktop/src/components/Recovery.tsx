import type { Recovery as RecoveryEntry } from "../../../../packages/shell/files";
import type { Translator } from "../../../../packages/i18n";
import {
  AppIcon,
  Button,
  EmptyState,
  IconButton,
} from "../../../../packages/ui";
export function Recovery({
  files,
  t,
  locale,
  restore,
  discard,
}: {
  files: RecoveryEntry[];
  t: Translator;
  locale: string;
  restore: (id: string) => void;
  discard: (id: string) => void;
}) {
  return (
    <main className="recovery-page">
      <div className="page-heading">
        <h1>{t("recovery")}</h1>
        <p>{t("recoveryText")}</p>
      </div>
      {files.length ? (
        <div className="recovery-list">
          {files.map((f) => (
            <article key={f.id}>
              <AppIcon kind={f.kind} />
              <div>
                <h3>{f.title}</h3>
                <span>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(f.modifiedAt)}
                </span>
              </div>
              <Button className="primary" onClick={() => restore(f.id)}>
                {t("restore")}
              </Button>
              <IconButton
                icon="delete"
                label={t("delete")}
                onClick={() => discard(f.id)}
              />
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="privacy"
          title={t("noRecovery")}
          text={t("noRecoveryText")}
        />
      )}
    </main>
  );
}
