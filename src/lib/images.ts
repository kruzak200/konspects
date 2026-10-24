import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const MAX_BYTES = 6 * 1024 * 1024;

export type SavedImage = {
  relativePath: string;
  absolutePath: string;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Resize/compress a browser File/Blob for offline storage. */
export async function prepareImageBlob(
  input: Blob,
): Promise<{ base64: string; extension: string; mime: string }> {
  const bitmap = await createImageBitmap(input);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось обработать изображение");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const preferPng = input.type === "image/png" || input.type === "image/gif";
  const mime = preferPng && scale === 1 ? "image/png" : "image/jpeg";
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Сжатие не удалось"))),
      mime,
      JPEG_QUALITY,
    );
  });
  if (blob.size > MAX_BYTES) {
    throw new Error(
      "Картинка слишком большая даже после сжатия. Выберите файл поменьше.",
    );
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  return {
    base64: bytesToBase64(buf),
    extension: mime === "image/png" ? "png" : "jpg",
    mime,
  };
}

async function savePrepared(
  subject: string,
  chapter: string,
  sectionId: string,
  prepared: { base64: string; extension: string },
): Promise<{ relativePath: string; displaySrc: string }> {
  if (!isTauri()) {
    // Browser preview: keep as data URL (not durable like Mac files).
    const dataUrl = `data:image/${prepared.extension === "png" ? "png" : "jpeg"};base64,${prepared.base64}`;
    return { relativePath: dataUrl, displaySrc: dataUrl };
  }
  const saved = await invoke<SavedImage>("save_section_image", {
    subject,
    chapter,
    sectionId,
    dataBase64: prepared.base64,
    extension: prepared.extension,
  });
  return {
    relativePath: saved.relativePath,
    displaySrc: convertFileSrc(saved.absolutePath),
  };
}

/** Open a file picker and save the image into the chapter assets folder. */
export async function pickAndSaveImage(opts: {
  subject: string;
  chapter: string;
  sectionId: string;
}): Promise<{ relativePath: string; displaySrc: string } | null> {
  if (!isTauri()) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    const file = await new Promise<File | null>((resolve) => {
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.click();
    });
    if (!file) return null;
    const prepared = await prepareImageBlob(file);
    return savePrepared(opts.subject, opts.chapter, opts.sectionId, prepared);
  }

  const selected = await open({
    multiple: false,
    filters: [
      {
        name: "Изображения",
        extensions: ["png", "jpg", "jpeg", "webp", "gif"],
      },
    ],
    title: "Выбрать картинку",
  });
  if (!selected || Array.isArray(selected)) return null;

  const res = await fetch(convertFileSrc(selected));
  if (!res.ok) throw new Error("Не удалось прочитать файл");
  const blob = await res.blob();
  const prepared = await prepareImageBlob(blob);
  return savePrepared(opts.subject, opts.chapter, opts.sectionId, prepared);
}

/** Save a clipboard/pasted image blob into assets. */
export async function savePastedImage(opts: {
  subject: string;
  chapter: string;
  sectionId: string;
  blob: Blob;
}): Promise<{ relativePath: string; displaySrc: string }> {
  const prepared = await prepareImageBlob(opts.blob);
  return savePrepared(opts.subject, opts.chapter, opts.sectionId, prepared);
}

/** Rewrite `assets/…` markdown image URLs for display in the webview. */
export function resolveMarkdownImages(
  markdown: string,
  chapterPath: string | null,
): string {
  if (!markdown) return markdown;
  if (!isTauri() || !chapterPath) return markdown;
  return markdown.replace(
    /!\[([^\]]*)\]\((assets\/[^)\s]+)\)/g,
    (_full, alt: string, rel: string) => {
      const abs = `${chapterPath.replace(/\\/g, "/")}/${rel}`;
      return `![${alt}](${convertFileSrc(abs)})`;
    },
  );
}

/**
 * When saving editor HTML → markdown, turn asset protocol / file URLs
 * back into relative `assets/…` paths.
 */
export function relativizeImageSrc(src: string, chapterPath: string | null): string {
  if (!src) return src;
  if (src.startsWith("assets/")) return src;
  if (src.startsWith("data:")) return src;
  if (!chapterPath) return src;
  const normChapter = chapterPath.replace(/\\/g, "/");
  try {
    const decoded = decodeURIComponent(src);
    const marker = "/assets/";
    const idx = decoded.indexOf(marker);
    if (idx >= 0) {
      const fromAssets = decoded.slice(idx + 1); // assets/...
      if (fromAssets.startsWith("assets/")) return fromAssets;
    }
    // Match absolute path containing the chapter folder
    const chapIdx = decoded.indexOf(normChapter);
    if (chapIdx >= 0) {
      const rest = decoded.slice(chapIdx + normChapter.length).replace(/^[/\\]/, "");
      if (rest.startsWith("assets/")) return rest;
    }
  } catch {
    /* ignore */
  }
  return src;
}

/** Rewrite image URLs in Markdown back to relative `assets/…` for disk. */
export function relativizeMarkdownImages(
  markdown: string,
  chapterPath: string | null,
): string {
  if (!markdown) return markdown;
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_full, alt: string, src: string) => {
      const rel = relativizeImageSrc(src, chapterPath);
      return `![${alt}](${rel})`;
    },
  );
}

export type LoadedImageBytes = {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  width?: number;
  height?: number;
};

function mimeFromPathOrUrl(src: string): LoadedImageBytes["mime"] {
  const lower = src.toLowerCase().split("?")[0];
  if (lower.endsWith(".png") || lower.includes("image/png")) return "image/png";
  if (lower.endsWith(".gif") || lower.includes("image/gif")) return "image/gif";
  if (lower.endsWith(".webp") || lower.includes("image/webp")) return "image/webp";
  return "image/jpeg";
}

/** Load image bytes for export (relative assets/, data URL, or asset protocol). */
export async function loadImageForExport(
  src: string,
  chapterPath: string | null,
): Promise<LoadedImageBytes | null> {
  const trimmed = src.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith("data:")) {
      const match = trimmed.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
      if (!match) return null;
      const mime = mimeFromPathOrUrl(match[1]);
      const binary = atob(match[2]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { bytes, mime };
    }

    let fetchUrl = trimmed;
    if (trimmed.startsWith("assets/") && chapterPath) {
      const abs = `${chapterPath.replace(/\\/g, "/")}/${trimmed}`;
      fetchUrl = isTauri() ? convertFileSrc(abs) : abs;
    } else if (
      isTauri() &&
      (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed))
    ) {
      fetchUrl = convertFileSrc(trimmed);
    }

    const res = await fetch(fetchUrl);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length) return null;
    return { bytes: buf, mime: mimeFromPathOrUrl(trimmed) };
  } catch {
    return null;
  }
}
