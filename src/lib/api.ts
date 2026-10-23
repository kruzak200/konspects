import { invoke } from "@tauri-apps/api/core";

export type LibraryInfo = {
  path: string;
};

export type SectionInfo = {
  id: string;
  title: string;
  titleIsCustom: boolean;
};

export type ChapterSnapshot = {
  sections: SectionInfo[];
  activeId: string;
  content: string;
};

const STORAGE_KEY = "konspects-browser-library-v2";

type BrowserSection = {
  id: string;
  customTitle: string | null;
  content: string;
};

type BrowserChapter = {
  sections: BrowserSection[];
};

type BrowserStore = {
  subjects: Record<string, Record<string, BrowserChapter>>;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function newId(): string {
  return `s_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function autoTitle(content: string): string {
  const line =
    content
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  let title = line
    .replace(/<[^>]+>/g, " ")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (title.startsWith("**") && title.endsWith("**") && title.length > 4) {
    title = title.slice(2, -2).trim();
  }
  if (!title) return "Без названия";
  if ([...title].length > 80) return `${[...title].slice(0, 77).join("")}…`;
  return title;
}

function toInfo(s: BrowserSection): SectionInfo {
  const custom = s.customTitle?.trim();
  return {
    id: s.id,
    title: custom ? custom : autoTitle(s.content),
    titleIsCustom: Boolean(custom),
  };
}

function snapshot(ch: BrowserChapter, activeId?: string): ChapterSnapshot {
  if (!ch.sections.length) throw new Error("В главе нет разделов");
  const active =
    ch.sections.find((s) => s.id === activeId)?.id ?? ch.sections[0].id;
  const section = ch.sections.find((s) => s.id === active)!;
  return {
    sections: ch.sections.map(toInfo),
    activeId: active,
    content: section.content,
  };
}

function emptyChapter(): BrowserChapter {
  return {
    sections: [{ id: newId(), customTitle: null, content: "" }],
  };
}

function migrateV1IfNeeded(): void {
  const v1 = localStorage.getItem("konspects-browser-library-v1");
  if (!v1 || localStorage.getItem(STORAGE_KEY)) return;
  try {
    const old = JSON.parse(v1) as {
      subjects: Record<string, Record<string, string>>;
    };
    const next: BrowserStore = { subjects: {} };
    for (const [subj, chapters] of Object.entries(old.subjects || {})) {
      next.subjects[subj] = {};
      for (const [chName, content] of Object.entries(chapters)) {
        next.subjects[subj][chName] = {
          sections: [
            { id: newId(), customTitle: null, content: content ?? "" },
          ],
        };
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function loadBrowserStore(): BrowserStore {
  migrateV1IfNeeded();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as BrowserStore;
  } catch {
    /* ignore */
  }
  return { subjects: {} };
}

function saveBrowserStore(store: BrowserStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function validateName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Название не может быть пустым");
  if (/[/\\]/.test(trimmed) || trimmed.includes("\0")) {
    throw new Error("Название не должно содержать слэши");
  }
  if (trimmed === "." || trimmed === ".." || trimmed.startsWith(".")) {
    throw new Error("Недопустимое название");
  }
  return trimmed;
}

function getChapter(store: BrowserStore, subject: string, chapter: string) {
  const chapters = store.subjects[subject];
  if (!chapters) throw new Error("Предмет не найден");
  const ch = chapters[chapter];
  if (!ch) throw new Error("Глава не найдена");
  return ch;
}

export async function getLibraryInfo(): Promise<LibraryInfo> {
  if (!isTauri()) {
    return {
      path: "Браузерный режим (локальное хранилище) — на Mac данные будут в Документы/Konspects",
    };
  }
  return invoke<LibraryInfo>("get_library_info");
}

export async function listSubjects(): Promise<string[]> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    return Object.keys(store.subjects).sort((a, b) =>
      a.localeCompare(b, "ru", { sensitivity: "base" }),
    );
  }
  return invoke<string[]>("list_subjects");
}

export async function createSubject(name: string): Promise<string> {
  if (!isTauri()) {
    const n = validateName(name);
    const store = loadBrowserStore();
    if (store.subjects[n]) throw new Error("Такой предмет уже есть");
    store.subjects[n] = {};
    saveBrowserStore(store);
    return n;
  }
  return invoke<string>("create_subject", { name });
}

export async function renameSubject(
  oldName: string,
  newName: string,
): Promise<string> {
  if (!isTauri()) {
    const next = validateName(newName);
    const store = loadBrowserStore();
    if (!store.subjects[oldName]) throw new Error("Предмет не найден");
    if (store.subjects[next]) {
      throw new Error("Предмет с таким названием уже есть");
    }
    store.subjects[next] = store.subjects[oldName];
    delete store.subjects[oldName];
    saveBrowserStore(store);
    return next;
  }
  return invoke<string>("rename_subject", { oldName, newName });
}

export async function deleteSubject(name: string): Promise<void> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    if (!store.subjects[name]) throw new Error("Предмет не найден");
    delete store.subjects[name];
    saveBrowserStore(store);
    return;
  }
  return invoke("delete_subject", { name });
}

export async function listChapters(subject: string): Promise<string[]> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const chapters = store.subjects[subject];
    if (!chapters) throw new Error("Предмет не найден");
    return Object.keys(chapters).sort((a, b) =>
      a.localeCompare(b, "ru", { sensitivity: "base" }),
    );
  }
  return invoke<string[]>("list_chapters", { subject });
}

export async function createChapter(
  subject: string,
  name: string,
): Promise<string> {
  if (!isTauri()) {
    const n = validateName(name);
    const store = loadBrowserStore();
    const chapters = store.subjects[subject];
    if (!chapters) throw new Error("Предмет не найден");
    if (chapters[n]) throw new Error("Такая глава уже есть");
    chapters[n] = emptyChapter();
    saveBrowserStore(store);
    return n;
  }
  return invoke<string>("create_chapter", { subject, name });
}

export async function renameChapter(
  subject: string,
  oldName: string,
  newName: string,
): Promise<string> {
  if (!isTauri()) {
    const next = validateName(newName);
    const store = loadBrowserStore();
    const chapters = store.subjects[subject];
    if (!chapters || !chapters[oldName]) throw new Error("Глава не найдена");
    if (chapters[next]) throw new Error("Глава с таким названием уже есть");
    chapters[next] = chapters[oldName];
    delete chapters[oldName];
    saveBrowserStore(store);
    return next;
  }
  return invoke<string>("rename_chapter", { subject, oldName, newName });
}

export async function deleteChapter(
  subject: string,
  name: string,
): Promise<void> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const chapters = store.subjects[subject];
    if (!chapters || !chapters[name]) throw new Error("Глава не найдена");
    delete chapters[name];
    saveBrowserStore(store);
    return;
  }
  return invoke("delete_chapter", { subject, name });
}

export async function openChapter(
  subject: string,
  chapter: string,
  sectionId?: string | null,
): Promise<ChapterSnapshot> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    return snapshot(ch, sectionId ?? undefined);
  }
  return invoke<ChapterSnapshot>("open_chapter", {
    subject,
    chapter,
    sectionId: sectionId ?? null,
  });
}

export async function createSection(
  subject: string,
  chapter: string,
): Promise<ChapterSnapshot> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    const id = newId();
    ch.sections.push({ id, customTitle: null, content: "" });
    saveBrowserStore(store);
    return snapshot(ch, id);
  }
  return invoke<ChapterSnapshot>("create_section", { subject, chapter });
}

export async function deleteSection(
  subject: string,
  chapter: string,
  sectionId: string,
): Promise<ChapterSnapshot> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    if (ch.sections.length <= 1) {
      throw new Error("Нельзя удалить единственный раздел");
    }
    ch.sections = ch.sections.filter((s) => s.id !== sectionId);
    saveBrowserStore(store);
    return snapshot(ch);
  }
  return invoke<ChapterSnapshot>("delete_section", {
    subject,
    chapter,
    sectionId,
  });
}

export async function setSectionTitle(
  subject: string,
  chapter: string,
  sectionId: string,
  customTitle: string | null,
): Promise<ChapterSnapshot> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    const section = ch.sections.find((s) => s.id === sectionId);
    if (!section) throw new Error("Раздел не найден");
    const trimmed = customTitle?.trim() || null;
    section.customTitle = trimmed;
    saveBrowserStore(store);
    return snapshot(ch, sectionId);
  }
  return invoke<ChapterSnapshot>("set_section_title", {
    subject,
    chapter,
    sectionId,
    customTitle,
  });
}

export async function writeSection(
  subject: string,
  chapter: string,
  sectionId: string,
  content: string,
): Promise<ChapterSnapshot> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    const section = ch.sections.find((s) => s.id === sectionId);
    if (!section) throw new Error("Раздел не найден");
    section.content = content;
    saveBrowserStore(store);
    return snapshot(ch, sectionId);
  }
  return invoke<ChapterSnapshot>("write_section", {
    subject,
    chapter,
    sectionId,
    content,
  });
}

export async function readChapterExport(
  subject: string,
  chapter: string,
): Promise<string> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    return ch.sections
      .map((s) => {
        const title = toInfo(s).title;
        const body = s.content.trim();
        if (!body) return "";
        return `# ${title}\n\n${body}`;
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return invoke<string>("read_chapter_export", { subject, chapter });
}

export function usingBrowserFallback(): boolean {
  return !isTauri();
}
