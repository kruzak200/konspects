import { invoke } from "@tauri-apps/api/core";

export type LibraryInfo = {
  path: string;
};

const STORAGE_KEY = "konspects-browser-library-v1";

type BrowserStore = {
  subjects: Record<string, Record<string, string>>;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function loadBrowserStore(): BrowserStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as BrowserStore;
    }
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

async function browserApi<T>(op: () => T): Promise<T> {
  return op();
}

export async function getLibraryInfo(): Promise<LibraryInfo> {
  if (!isTauri()) {
    return browserApi(() => ({
      path: "Браузерный режим (локальное хранилище) — на Mac данные будут в Документы/Konspects",
    }));
  }
  return invoke<LibraryInfo>("get_library_info");
}

export async function listSubjects(): Promise<string[]> {
  if (!isTauri()) {
    return browserApi(() => {
      const store = loadBrowserStore();
      return Object.keys(store.subjects).sort((a, b) =>
        a.localeCompare(b, "ru", { sensitivity: "base" }),
      );
    });
  }
  return invoke<string[]>("list_subjects");
}

export async function createSubject(name: string): Promise<string> {
  if (!isTauri()) {
    return browserApi(() => {
      const n = validateName(name);
      const store = loadBrowserStore();
      if (store.subjects[n]) throw new Error("Такой предмет уже есть");
      store.subjects[n] = {};
      saveBrowserStore(store);
      return n;
    });
  }
  return invoke<string>("create_subject", { name });
}

export async function renameSubject(
  oldName: string,
  newName: string,
): Promise<string> {
  if (!isTauri()) {
    return browserApi(() => {
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
    });
  }
  return invoke<string>("rename_subject", { oldName, newName });
}

export async function deleteSubject(name: string): Promise<void> {
  if (!isTauri()) {
    return browserApi(() => {
      const store = loadBrowserStore();
      if (!store.subjects[name]) throw new Error("Предмет не найден");
      delete store.subjects[name];
      saveBrowserStore(store);
    });
  }
  return invoke("delete_subject", { name });
}

export async function listChapters(subject: string): Promise<string[]> {
  if (!isTauri()) {
    return browserApi(() => {
      const store = loadBrowserStore();
      const chapters = store.subjects[subject];
      if (!chapters) throw new Error("Предмет не найден");
      return Object.keys(chapters).sort((a, b) =>
        a.localeCompare(b, "ru", { sensitivity: "base" }),
      );
    });
  }
  return invoke<string[]>("list_chapters", { subject });
}

export async function createChapter(
  subject: string,
  name: string,
): Promise<string> {
  if (!isTauri()) {
    return browserApi(() => {
      const n = validateName(name);
      const store = loadBrowserStore();
      const chapters = store.subjects[subject];
      if (!chapters) throw new Error("Предмет не найден");
      if (chapters[n] !== undefined) throw new Error("Такая глава уже есть");
      chapters[n] = "";
      saveBrowserStore(store);
      return n;
    });
  }
  return invoke<string>("create_chapter", { subject, name });
}

export async function renameChapter(
  subject: string,
  oldName: string,
  newName: string,
): Promise<string> {
  if (!isTauri()) {
    return browserApi(() => {
      const next = validateName(newName);
      const store = loadBrowserStore();
      const chapters = store.subjects[subject];
      if (!chapters || chapters[oldName] === undefined) {
        throw new Error("Глава не найдена");
      }
      if (chapters[next] !== undefined) {
        throw new Error("Глава с таким названием уже есть");
      }
      chapters[next] = chapters[oldName];
      delete chapters[oldName];
      saveBrowserStore(store);
      return next;
    });
  }
  return invoke<string>("rename_chapter", {
    subject,
    oldName,
    newName,
  });
}

export async function deleteChapter(
  subject: string,
  name: string,
): Promise<void> {
  if (!isTauri()) {
    return browserApi(() => {
      const store = loadBrowserStore();
      const chapters = store.subjects[subject];
      if (!chapters || chapters[name] === undefined) {
        throw new Error("Глава не найдена");
      }
      delete chapters[name];
      saveBrowserStore(store);
    });
  }
  return invoke("delete_chapter", { subject, name });
}

export async function readChapter(
  subject: string,
  name: string,
): Promise<string> {
  if (!isTauri()) {
    return browserApi(() => {
      const store = loadBrowserStore();
      const chapters = store.subjects[subject];
      if (!chapters || chapters[name] === undefined) {
        throw new Error("Глава не найдена");
      }
      return chapters[name];
    });
  }
  return invoke<string>("read_chapter", { subject, name });
}

export async function writeChapter(
  subject: string,
  name: string,
  content: string,
): Promise<void> {
  if (!isTauri()) {
    return browserApi(() => {
      const store = loadBrowserStore();
      const chapters = store.subjects[subject];
      if (!chapters || chapters[name] === undefined) {
        throw new Error("Глава не найдена");
      }
      chapters[name] = content;
      saveBrowserStore(store);
    });
  }
  return invoke("write_chapter", { subject, name, content });
}

export function usingBrowserFallback(): boolean {
  return !isTauri();
}
