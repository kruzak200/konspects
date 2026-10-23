import { useEffect, useState, type FormEvent } from "react";
import {
  createChapter,
  createSection,
  createSubject,
  deleteChapter,
  deleteSection,
  deleteSubject,
  getLibraryInfo,
  listChapters,
  listSubjects,
  openChapter as openChapterApi,
  readChapterExport,
  renameChapter,
  renameSubject,
  setSectionTitle,
  usingBrowserFallback,
  writeSection,
  type SectionInfo,
} from "./lib/api";
import { ConspectEditor } from "./components/ConspectEditor";
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
      sectionId: string;
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
  const [sections, setSections] = useState<SectionInfo[]>([]);
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [editorReset, setEditorReset] = useState(0);
  const [libraryPath, setLibraryPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState<"chapter" | "section" | null>(null);

  async function refreshSubjects() {
    setSubjects(await listSubjects());
  }

  async function refreshChapters(subject: string) {
    setChapters(await listChapters(subject));
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
        : `chapter:${view.subject}:${view.chapter}:${view.sectionId}:${view.mode}`;

  useEffect(() => {
    setError(null);
    setNotice(null);
    setNewName("");
    setRenameValue("");
    setRenaming(null);
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

  function applySnapshot(
    subject: string,
    chapter: string,
    snap: Awaited<ReturnType<typeof openChapterApi>>,
    mode: "read" | "edit",
  ) {
    setSections(snap.sections);
    setContent(snap.content);
    setDraft(snap.content);
    setEditorReset((n) => n + 1);
    const openMode = mode === "edit" || !snap.content.trim() ? "edit" : mode;
    setView({
      kind: "chapter",
      subject,
      chapter,
      mode: openMode,
      sectionId: snap.activeId,
    });
  }

  async function openChapter(
    subject: string,
    chapter: string,
    mode: "read" | "edit" = "read",
    sectionId?: string,
  ) {
    setBusy(true);
    setError(null);
    try {
      const snap = await openChapterApi(subject, chapter, sectionId);
      applySnapshot(subject, chapter, snap, mode);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function switchSection(sectionId: string) {
    if (view.kind !== "chapter") return;
    if (sectionId === view.sectionId) return;
    if (view.mode === "edit" && draft !== content) {
      if (
        !confirm(
          "В разделе есть несохранённые правки. Переключить без сохранения?",
        )
      ) {
        return;
      }
    }
    await openChapter(view.subject, view.chapter, view.mode, sectionId);
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

  async function onSaveSection() {
    if (view.kind !== "chapter") return;
    setBusy(true);
    setError(null);
    try {
      const snap = await writeSection(
        view.subject,
        view.chapter,
        view.sectionId,
        draft,
      );
      setSections(snap.sections);
      setContent(snap.content);
      setDraft(snap.content);
      setNotice("Раздел сохранён");
      setView({ ...view, mode: "read", sectionId: snap.activeId });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onAddSection() {
    if (view.kind !== "chapter") return;
    if (view.mode === "edit" && draft !== content) {
      if (
        !confirm(
          "В текущем разделе есть несохранённые правки. Создать новый без сохранения?",
        )
      ) {
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const snap = await createSection(view.subject, view.chapter);
      applySnapshot(view.subject, view.chapter, snap, "edit");
      setNotice("Раздел создан — вставьте текст из Merlin");
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteActiveSection() {
    if (view.kind !== "chapter") return;
    const current = sections.find((s) => s.id === view.sectionId);
    if (!current) return;
    if (sections.length <= 1) {
      setError("Нельзя удалить единственный раздел");
      return;
    }
    if (!confirm(`Удалить раздел «${current.title}»?`)) return;
    setBusy(true);
    setError(null);
    try {
      const snap = await deleteSection(
        view.subject,
        view.chapter,
        view.sectionId,
      );
      applySnapshot(view.subject, view.chapter, snap, "read");
      setNotice("Раздел удалён");
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
      setRenaming(null);
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
      setRenaming(null);
      setView({ ...view, chapter: next });
      setNotice("Глава переименована");
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRenameSection() {
    if (view.kind !== "chapter") return;
    setBusy(true);
    setError(null);
    try {
      const snap = await setSectionTitle(
        view.subject,
        view.chapter,
        view.sectionId,
        renameValue.trim() || null,
      );
      setSections(snap.sections);
      setRenaming(null);
      setNotice(
        renameValue.trim()
          ? "Своё название раздела сохранено"
          : "Снова автоимя из первой строки",
      );
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onResetSectionTitle() {
    if (view.kind !== "chapter") return;
    setBusy(true);
    setError(null);
    try {
      const snap = await setSectionTitle(
        view.subject,
        view.chapter,
        view.sectionId,
        null,
      );
      setSections(snap.sections);
      setRenaming(null);
      setNotice("Название снова из первой строки текста");
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
    if (!confirm(`Удалить главу «${view.chapter}» со всеми разделами?`)) return;
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

  async function onExport(format: "docx" | "pdf") {
    if (view.kind !== "chapter") return;
    setBusy(true);
    setError(null);
    try {
      // Prefer saved chapter (all sections). Warn if current edit unsaved.
      if (view.mode === "edit" && draft !== content) {
        if (
          !confirm(
            "Есть несохранённые правки в текущем разделе. Экспортировать сохранённую версию главы?",
          )
        ) {
          setBusy(false);
          return;
        }
      }
      const markdown = await readChapterExport(view.subject, view.chapter);
      if (!markdown.trim()) {
        setError(
          "Нечего экспортировать — конспект пуст. Сначала вставьте и сохраните текст.",
        );
        return;
      }
      const { exportChapter } = await import("./lib/export/saveExport");
      const result = await exportChapter({
        format,
        markdown,
        subject: view.subject,
        chapter: view.chapter,
      });
      if ("path" in result) {
        setNotice(`Экспорт сохранён: ${result.path}`);
      } else {
        setNotice(`Файл скачан: ${result.downloaded}`);
      }
    } catch (err) {
      const msg = errMessage(err);
      if (msg.includes("отменён") || msg.toLowerCase().includes("cancel")) {
        setNotice(null);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const activeSection =
    view.kind === "chapter"
      ? sections.find((s) => s.id === view.sectionId)
      : undefined;

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
              {renaming !== "chapter" ? (
                <>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setRenaming("chapter");
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
                    onClick={() => setRenaming(null)}
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
                Глав ещё нет. Создайте главу и вставьте конспект из Merlin по
                разделам.
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
                      <span className="entity-meta">открыть</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {view.kind === "chapter" && (
          <section className="panel chapter-panel chapter-with-sections">
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
                    setEditorReset((n) => n + 1);
                    setView({ ...view, mode: "edit" });
                  }}
                >
                  Править
                </button>
              </div>
            </div>

            <div className="toolbar">
              {renaming !== "chapter" ? (
                <>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setRenaming("chapter");
                      setRenameValue(view.chapter);
                    }}
                  >
                    Переименовать главу
                  </button>
                  <button
                    type="button"
                    className="ghost danger"
                    onClick={onDeleteChapter}
                    disabled={busy}
                  >
                    Удалить главу
                  </button>
                  <span className="toolbar-gap" aria-hidden="true" />
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => onExport("docx")}
                    disabled={busy}
                    title="Вся глава (все разделы) в Word"
                  >
                    Экспорт в DOCX
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => onExport("pdf")}
                    disabled={busy}
                    title="Вся глава (все разделы) в PDF"
                  >
                    Экспорт в PDF
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
                    onClick={() => setRenaming(null)}
                  >
                    Отмена
                  </button>
                </div>
              )}
            </div>

            <div className="chapter-layout">
              <aside className="sections-rail" aria-label="Разделы">
                <div className="sections-rail-head">
                  <h2 className="sections-title">Разделы</h2>
                  <button
                    type="button"
                    className="ghost compact"
                    onClick={onAddSection}
                    disabled={busy}
                  >
                    + Раздел
                  </button>
                </div>
                <p className="sections-hint">
                  Имя = первая строка текста, пока вы не зададите своё.
                </p>
                <ul className="section-list">
                  {sections.map((section) => (
                    <li key={section.id}>
                      <button
                        type="button"
                        className={
                          section.id === view.sectionId
                            ? "section-btn active"
                            : "section-btn"
                        }
                        onClick={() => switchSection(section.id)}
                        disabled={busy}
                      >
                        <span className="section-btn-title">
                          {section.title}
                        </span>
                        {section.titleIsCustom && (
                          <span className="section-badge">своё</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </aside>

              <div className="section-main">
                <div className="section-toolbar">
                  <p className="section-current">
                    Раздел: <strong>{activeSection?.title ?? "…"}</strong>
                  </p>
                  {renaming !== "section" ? (
                    <div className="section-actions">
                      <button
                        type="button"
                        className="ghost compact"
                        onClick={() => {
                          setRenaming("section");
                          setRenameValue(
                            activeSection?.titleIsCustom
                              ? activeSection.title
                              : "",
                          );
                        }}
                        disabled={busy}
                      >
                        Название…
                      </button>
                      {activeSection?.titleIsCustom && (
                        <button
                          type="button"
                          className="ghost compact"
                          onClick={onResetSectionTitle}
                          disabled={busy}
                        >
                          Автоимя
                        </button>
                      )}
                      <button
                        type="button"
                        className="ghost compact danger"
                        onClick={onDeleteActiveSection}
                        disabled={busy || sections.length <= 1}
                      >
                        Удалить
                      </button>
                    </div>
                  ) : (
                    <div className="inline-rename">
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        placeholder="Своё название (пусто = авто)"
                        aria-label="Название раздела"
                      />
                      <button
                        type="button"
                        onClick={onRenameSection}
                        disabled={busy}
                      >
                        ОК
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setRenaming(null)}
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
                      Вставьте сюда один раздел из Merlin. Первая строка станет
                      названием в списке слева (если нет своего имени).
                    </p>
                    <ConspectEditor
                      resetKey={`${view.subject}/${view.chapter}/${view.sectionId}/${editorReset}`}
                      initialMarkdown={draft}
                      onChangeMarkdown={setDraft}
                      disabled={busy}
                    />
                    <div className="editor-actions">
                      <button
                        type="button"
                        onClick={onSaveSection}
                        disabled={busy}
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setDraft(content);
                          setEditorReset((n) => n + 1);
                          setView({ ...view, mode: "read" });
                        }}
                        disabled={busy}
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
