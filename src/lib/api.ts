import { invoke } from "@tauri-apps/api/core";

export type LibraryInfo = {
  path: string;
};

export type SubsectionInfo = {
  id: string;
  title: string;
  titleIsCustom: boolean;
};

export type SectionInfo = {
  id: string;
  title: string;
  titleIsCustom: boolean;
  subsections: SubsectionInfo[];
};

export type ChapterSnapshot = {
  sections: SectionInfo[];
  activeSectionId: string;
  activeSubsectionId: string;
  content: string;
  /** Absolute chapter folder path (Tauri); empty in browser preview. */
  chapterPath: string;
};

const STORAGE_KEY = "konspects-browser-library-v3";

type BrowserSubsection = {
  id: string;
  customTitle: string | null;
  content: string;
};

type BrowserSection = {
  id: string;
  customTitle: string | null;
  subsections: BrowserSubsection[];
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

function newSectionId(): string {
  return `s_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function newSubsectionId(): string {
  return `u_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function plainTitleText(raw: string): string {
  let title = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (title.startsWith("**") && title.endsWith("**") && title.length > 4) {
    title = title.slice(2, -2).trim();
  }
  return title;
}

function isImageOnlyLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(t)) return true;
  if (/^<img\b[^>]*>\s*$/i.test(t)) return true;
  if (/^data:image\//i.test(t)) return true;
  return false;
}

function autoTitle(content: string): string {
  const mdHeading = content.match(/^#{1,3}\s+(.+)$/m);
  if (mdHeading) {
    const t = plainTitleText(mdHeading[1]);
    if (t) return t.length > 80 ? `${[...t].slice(0, 77).join("")}…` : t;
  }
  const htmlHeading = content.match(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/i);
  if (htmlHeading) {
    const t = plainTitleText(htmlHeading[2]);
    if (t) return t.length > 80 ? `${[...t].slice(0, 77).join("")}…` : t;
  }
  const line =
    content
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !isImageOnlyLine(l)) ?? "";
  const title = plainTitleText(line);
  if (!title) return "Без названия";
  if ([...title].length > 80) return `${[...title].slice(0, 77).join("")}…`;
  return title;
}

function subsectionToInfo(u: BrowserSubsection): SubsectionInfo {
  const custom = u.customTitle?.trim();
  return {
    id: u.id,
    title: custom ? custom : autoTitle(u.content),
    titleIsCustom: Boolean(custom),
  };
}

function sectionToInfo(s: BrowserSection): SectionInfo {
  const custom = s.customTitle?.trim();
  const subsections = s.subsections.map(subsectionToInfo);
  const titleFromSubs =
    subsections.map((u) => u.title).find((t) => t && t !== "Без названия") ??
    "Без названия";
  return {
    id: s.id,
    title: custom ? custom : titleFromSubs,
    titleIsCustom: Boolean(custom),
    subsections,
  };
}

function snapshot(
  ch: BrowserChapter,
  sectionId?: string,
  subsectionId?: string,
): ChapterSnapshot {
  if (!ch.sections.length) throw new Error("В главе нет разделов");
  const activeSection =
    ch.sections.find((s) => s.id === sectionId) ?? ch.sections[0];
  if (!activeSection.subsections.length) {
    throw new Error("В разделе нет подразделов");
  }
  const activeSub =
    activeSection.subsections.find((u) => u.id === subsectionId) ??
    activeSection.subsections[0];
  return {
    sections: ch.sections.map(sectionToInfo),
    activeSectionId: activeSection.id,
    activeSubsectionId: activeSub.id,
    content: activeSub.content,
    chapterPath: "",
  };
}

function emptyChapter(): BrowserChapter {
  return {
    sections: [
      {
        id: newSectionId(),
        customTitle: null,
        subsections: [
          { id: newSubsectionId(), customTitle: null, content: "" },
        ],
      },
    ],
  };
}

function migrateBrowserStore(): void {
  if (localStorage.getItem(STORAGE_KEY)) return;

  const v2 = localStorage.getItem("konspects-browser-library-v2");
  if (v2) {
    try {
      const old = JSON.parse(v2) as {
        subjects: Record<
          string,
          Record<
            string,
            {
              sections: {
                id: string;
                customTitle: string | null;
                content: string;
              }[];
            }
          >
        >;
      };
      const next: BrowserStore = { subjects: {} };
      for (const [subj, chapters] of Object.entries(old.subjects || {})) {
        next.subjects[subj] = {};
        for (const [chName, ch] of Object.entries(chapters)) {
          next.subjects[subj][chName] = {
            sections: (ch.sections || []).map((s) => ({
              id: s.id,
              customTitle: s.customTitle,
              subsections: [
                {
                  id: newSubsectionId(),
                  customTitle: null,
                  content: s.content ?? "",
                },
              ],
            })),
          };
          if (!next.subjects[subj][chName].sections.length) {
            next.subjects[subj][chName] = emptyChapter();
          }
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return;
    } catch {
      /* fall through */
    }
  }

  const v1 = localStorage.getItem("konspects-browser-library-v1");
  if (!v1) return;
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
            {
              id: newSectionId(),
              customTitle: null,
              subsections: [
                {
                  id: newSubsectionId(),
                  customTitle: null,
                  content: content ?? "",
                },
              ],
            },
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
  migrateBrowserStore();
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

function findSection(ch: BrowserChapter, sectionId: string): BrowserSection {
  const section = ch.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error("Раздел не найден");
  return section;
}

function findSubsection(
  section: BrowserSection,
  subsectionId: string,
): BrowserSubsection {
  const sub = section.subsections.find((u) => u.id === subsectionId);
  if (!sub) throw new Error("Подраздел не найден");
  return sub;
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
  subsectionId?: string | null,
): Promise<ChapterSnapshot> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    return snapshot(ch, sectionId ?? undefined, subsectionId ?? undefined);
  }
  return invoke<ChapterSnapshot>("open_chapter", {
    subject,
    chapter,
    sectionId: sectionId ?? null,
    subsectionId: subsectionId ?? null,
  });
}

export async function createSection(
  subject: string,
  chapter: string,
): Promise<ChapterSnapshot> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    const sid = newSectionId();
    const uid = newSubsectionId();
    ch.sections.push({
      id: sid,
      customTitle: null,
      subsections: [{ id: uid, customTitle: null, content: "" }],
    });
    saveBrowserStore(store);
    return snapshot(ch, sid, uid);
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
    const section = findSection(ch, sectionId);
    section.customTitle = customTitle?.trim() || null;
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

export async function createSubsection(
  subject: string,
  chapter: string,
  sectionId: string,
): Promise<ChapterSnapshot> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    const section = findSection(ch, sectionId);
    const uid = newSubsectionId();
    section.subsections.push({ id: uid, customTitle: null, content: "" });
    saveBrowserStore(store);
    return snapshot(ch, sectionId, uid);
  }
  return invoke<ChapterSnapshot>("create_subsection", {
    subject,
    chapter,
    sectionId,
  });
}

export async function deleteSubsection(
  subject: string,
  chapter: string,
  sectionId: string,
  subsectionId: string,
): Promise<ChapterSnapshot> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    const section = findSection(ch, sectionId);
    if (section.subsections.length <= 1) {
      throw new Error("Нельзя удалить единственный подраздел");
    }
    section.subsections = section.subsections.filter(
      (u) => u.id !== subsectionId,
    );
    saveBrowserStore(store);
    return snapshot(ch, sectionId);
  }
  return invoke<ChapterSnapshot>("delete_subsection", {
    subject,
    chapter,
    sectionId,
    subsectionId,
  });
}

export async function setSubsectionTitle(
  subject: string,
  chapter: string,
  sectionId: string,
  subsectionId: string,
  customTitle: string | null,
): Promise<ChapterSnapshot> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    const section = findSection(ch, sectionId);
    const sub = findSubsection(section, subsectionId);
    sub.customTitle = customTitle?.trim() || null;
    saveBrowserStore(store);
    return snapshot(ch, sectionId, subsectionId);
  }
  return invoke<ChapterSnapshot>("set_subsection_title", {
    subject,
    chapter,
    sectionId,
    subsectionId,
    customTitle,
  });
}

export async function writeSubsection(
  subject: string,
  chapter: string,
  sectionId: string,
  subsectionId: string,
  content: string,
): Promise<ChapterSnapshot> {
  if (!isTauri()) {
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    const section = findSection(ch, sectionId);
    const sub = findSubsection(section, subsectionId);
    sub.content = content;
    saveBrowserStore(store);
    return snapshot(ch, sectionId, subsectionId);
  }
  return invoke<ChapterSnapshot>("write_subsection", {
    subject,
    chapter,
    sectionId,
    subsectionId,
    content,
  });
}

export async function mergeSubsections(
  subject: string,
  chapter: string,
  sectionId: string,
  subsectionIds: string[],
  customTitle?: string | null,
): Promise<ChapterSnapshot> {
  if (!isTauri()) {
    if (subsectionIds.length < 2) {
      throw new Error("Выберите хотя бы два подраздела для объединения");
    }
    const store = loadBrowserStore();
    const ch = getChapter(store, subject, chapter);
    const section = findSection(ch, sectionId);
    const ordered = subsectionIds.map((id) => findSubsection(section, id));
    const parts: string[] = [];
    for (const sub of ordered) {
      const info = subsectionToInfo(sub);
      const body = sub.content.trim();
      if (!body) continue;
      const heading = `## ${info.title}`;
      if (
        body.startsWith(heading) ||
        body.startsWith(`# ${info.title}`)
      ) {
        parts.push(body);
      } else {
        parts.push(`${heading}\n\n${body}`);
      }
    }
    const keep = ordered[0];
    keep.content = parts.join("\n\n");
    const title = customTitle?.trim();
    if (title) keep.customTitle = title;
    const drop = new Set(subsectionIds.slice(1));
    section.subsections = section.subsections.filter((u) => !drop.has(u.id));
    saveBrowserStore(store);
    return snapshot(ch, sectionId, keep.id);
  }
  return invoke<ChapterSnapshot>("merge_subsections", {
    subject,
    chapter,
    sectionId,
    subsectionIds,
    customTitle: customTitle ?? null,
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
        const sInfo = sectionToInfo(s);
        const parts = s.subsections
          .map((u) => {
            const uInfo = subsectionToInfo(u);
            const body = u.content.trim();
            if (!body) return "";
            return `## ${uInfo.title}\n\n${body}`;
          })
          .filter(Boolean);
        if (!parts.length) return "";
        return `# ${sInfo.title}\n\n${parts.join("\n\n")}`;
      })
      .filter(Boolean)
      .join("\n\n");
  }
  return invoke<string>("read_chapter_export", { subject, chapter });
}

export function usingBrowserFallback(): boolean {
  return !isTauri();
}
