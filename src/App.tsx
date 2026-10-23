import { useEffect, useState, type FormEvent } from "react";
import {
  createChapter,
  createSubject,
  deleteChapter,
  deleteSubject,
  getLibraryInfo,
  listChapters,
  listSubjects,
  readChapter,
  renameChapter,
  renameSubject,
  usingBrowserFallback,
  writeChapter,
} from "./lib/api";
import { ConspectBlocks } from "./lib/markdown";
import "./App.css";

type View =
  | { kind: "subjects" }
  | { kind: "chapters"; subject: string }
  | {
      kind: "chapter";
      subject: string;
      chapter: string;
      mode: "read" | "edit";
    };

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Что-то пошло не так";
}

export default function App() {
  const [view, setView] = useState<View>({ kind: "subjects" });
  const [subjects, setSubjects] = useState<string[]>([]);
  const [chapters, setChapters] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [libraryPath, setLibraryPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);

  async function refreshSubjects() {
    const list = await listSubjects();
    setSubjects(list);
  }

  async function refreshChapters(subject: string) {
    const list = await listChapters(subject);
    setChapters(list);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await getLibraryInfo();
        if (cancelled) return;
        setLibraryPath(info.path);
        await refreshSubjects();
      } catch (e) {
        if (!cancelled) setError(errMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const viewKey =
    view.kind === "subjects"
      ? "subjects"
      : view.kind === "chapters"
        ? `chapters:${view.subject}`
        : `chapter:${view.subject}:${view.chapter}:${view.mode}`;

  useEffect(() => {
    setError(null);
    setNotice(null);
    setNewName("");
    setRenameValue("");
    setRenaming(false);
  }, [viewKey]);

  async function openSubject(subject: string) {
    setBusy(true);
    setError(null);
    try {
      await refreshChapters(subject);
      setView({ kind: "chapters", subject });
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function openChapter(
    subject: string,
    chapter: string,
    mode: "read" | "edit" = "read",
  ) {
    setBusy(true);
    setError(null);
    try {
      const text = await readChapter(subject, chapter);
      setContent(text);
      setDraft(text);
      setView({ kind: "chapter", subject, chapter, mode });
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateSubject(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const name = await createSubject(newName);
      setNewName("");
      await refreshSubjects();
      setNotice(`Предмет «${name}» создан`);
      await openSubject(name);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onCreateChapter(e: FormEvent) {
    e.preventDefault();
    if (view.kind !== "chapters") return;
    setBusy(true);
    setError(null);
    try {
      const name = await createChapter(view.subject, newName);
      setNewName("");
      await refreshChapters(view.subject);
      setNotice(`Глава «${name}» создана`);
      await openChapter(view.subject, name, "edit");
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveChapter() {
    if (view.kind !== "chapter") return;
    setBusy(true);
    setError(null);
    try {
      await writeChapter(view.subject, view.chapter, draft);
      setContent(draft);
      setNotice("Сохранено");
      setView({ ...view, mode: "read" });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRenameSubject() {
    if (view.kind !== "chapters") return;
    setBusy(true);
    setError(null);
    try {
      const next = await renameSubject(view.subject, renameValue);
      setRenaming(false);
      setView({ kind: "chapters", subject: next });
      await refreshSubjects();
      await refreshChapters(next);
      setNotice("Предмет переименован");
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRenameChapter() {
    if (view.kind !== "chapter") return;
    setBusy(true);
    setError(null);
    try {
      const next = await renameChapter(
        view.subject,
        view.chapter,
        renameValue,
      );
      setRenaming(false);
      setView({ ...view, chapter: next });
      setNotice("Глава переименована");
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteSubject() {
    if (view.kind !== "chapters") return;
    if (!confirm(`Удалить предмет «${view.subject}» и все главы?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteSubject(view.subject);
      setView({ kind: "subjects" });
      await refreshSubjects();
      setNotice("Предмет удалён");
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteChapter() {
    if (view.kind !== "chapter") return;
    if (!confirm(`Удалить главу «${view.chapter}»?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteChapter(view.subject, view.chapter);
      await refreshChapters(view.subject);
      setView({ kind: "chapters", subject: view.subject });
      setNotice("Глава удалена");
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="atmosphere" aria-hidden="true" />
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">Konspects</p>
          <p className="brand-sub">локальная библиотека конспектов</p>
        </div>
        <p className="library-path" title={libraryPath}>
          {usingBrowserFallback()
            ? "Превью в браузере · на Mac — папка Документы/Konspects"
            : libraryPath}
        </p>
      </header>

      <main className="stage">
        {error && (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        )}
        {notice && !error && (
          <div className="banner banner-ok" role="status">
            {notice}
          </div>
        )}

        {view.kind === "subjects" && (
          <section className="panel subjects-panel">
            <div className="panel-intro">
              <h1 className="panel-title">Предметы</h1>
              <p className="panel-lead">
                Сначала выберите или создайте предмет. Конспекты хранятся
                обычными файлами на диске.
              </p>
            </div>

            <form className="create-row" onSubmit={onCreateSubject}>
              <label className="sr-only" htmlFor="new-subject">
                Новый предмет
              </label>
              <input
                id="new-subject"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Название предмета"
                autoComplete="off"
                disabled={busy}
              />
              <button type="submit" disabled={busy || !newName.trim()}>
                Создать
              </button>
            </form>

            {subjects.length === 0 ? (
              <p className="empty-hint">Пока нет предметов — создайте первый.</p>
            ) : (
              <ul className="entity-list">
                {subjects.map((subject) => (
                  <li key={subject}>
                    <button
                      type="button"
                      className="entity-btn"
                      onClick={() => openSubject(subject)}
                      disabled={busy}
                    >
                      <span className="entity-name">{subject}</span>
                      <span className="entity-meta">открыть</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {view.kind === "chapters" && (
          <section className="panel chapters-panel">
            <nav className="crumbs">
              <button
                type="button"
                className="linkish"
                onClick={() => setView({ kind: "subjects" })}
              >
                ← Предметы
              </button>
            </nav>

            <div className="panel-intro">
              <h1 className="panel-title">{view.subject}</h1>
              <p className="panel-lead">Главы этого предмета</p>
            </div>

            <div className="toolbar">
              {!renaming ? (
                <>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setRenaming(true);
                      setRenameValue(view.subject);
                    }}
                  >
                    Переименовать
                  </button>
                  <button
                    type="button"
                    className="ghost danger"
                    onClick={onDeleteSubject}
                    disabled={busy}
                  >
                    Удалить
                  </button>
                </>
              ) : (
                <div className="inline-rename">
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    aria-label="Новое название предмета"
                  />
                  <button
                    type="button"
                    onClick={onRenameSubject}
                    disabled={busy || !renameValue.trim()}
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setRenaming(false)}
                  >
                    Отмена
                  </button>
                </div>
              )}
            </div>

            <form className="create-row" onSubmit={onCreateChapter}>
              <label className="sr-only" htmlFor="new-chapter">
                Новая глава
              </label>
              <input
                id="new-chapter"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Название главы"
                autoComplete="off"
                disabled={busy}
              />
              <button type="submit" disabled={busy || !newName.trim()}>
                Создать главу
              </button>
            </form>

            {chapters.length === 0 ? (
              <p className="empty-hint">
                Глав ещё нет. Создайте главу и вставьте конспект из Merlin.
              </p>
            ) : (
              <ul className="entity-list">
                {chapters.map((chapter) => (
                  <li key={chapter}>
                    <button
                      type="button"
                      className="entity-btn"
                      onClick={() => openChapter(view.subject, chapter)}
                      disabled={busy}
                    >
                      <span className="entity-name">{chapter}</span>
                      <span className="entity-meta">читать</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {view.kind === "chapter" && (
          <section className="panel chapter-panel">
            <nav className="crumbs">
              <button
                type="button"
                className="linkish"
                onClick={() => openSubject(view.subject)}
              >
                ← {view.subject}
              </button>
            </nav>

            <div className="chapter-head">
              <div>
                <p className="eyebrow">{view.subject}</p>
                <h1 className="panel-title">{view.chapter}</h1>
              </div>
              <div className="mode-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view.mode === "read"}
                  className={view.mode === "read" ? "active" : ""}
                  onClick={() => setView({ ...view, mode: "read" })}
                >
                  Читать
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view.mode === "edit"}
                  className={view.mode === "edit" ? "active" : ""}
                  onClick={() => {
                    setDraft(content);
                    setView({ ...view, mode: "edit" });
                  }}
                >
                  Вставить
                </button>
              </div>
            </div>

            <div className="toolbar">
              {!renaming ? (
                <>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setRenaming(true);
                      setRenameValue(view.chapter);
                    }}
                  >
                    Переименовать
                  </button>
                  <button
                    type="button"
                    className="ghost danger"
                    onClick={onDeleteChapter}
                    disabled={busy}
                  >
                    Удалить
                  </button>
                </>
              ) : (
                <div className="inline-rename">
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    aria-label="Новое название главы"
                  />
                  <button
                    type="button"
                    onClick={onRenameChapter}
                    disabled={busy || !renameValue.trim()}
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setRenaming(false)}
                  >
                    Отмена
                  </button>
                </div>
              )}
            </div>

            {view.mode === "read" ? (
              <article className="reader" aria-label="Конспект">
                <ConspectBlocks content={content} />
              </article>
            ) : (
              <div className="editor">
                <p className="editor-hint">
                  Вставьте сюда готовый конспект из Merlin. Сохраните — и он
                  останется в файле главы на диске.
                </p>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={"# Заголовок\n\nКороткий абзац…\n\n## Раздел\n\n- пункт\n- пункт"}
                  spellCheck
                  disabled={busy}
                />
                <div className="editor-actions">
                  <button
                    type="button"
                    onClick={onSaveChapter}
                    disabled={busy}
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setDraft(content);
                      setView({ ...view, mode: "read" });
                    }}
                    disabled={busy}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
