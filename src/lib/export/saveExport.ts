import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { buildDocxBytes } from "./docxExport";
import { buildPdfBytes } from "./pdfExport";

export type ExportFormat = "docx" | "pdf";

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

function downloadInBrowser(filename: string, bytes: Uint8Array, mime: string) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, " ").trim() || "konspekt";
}

export async function exportChapter(opts: {
  format: ExportFormat;
  markdown: string;
  subject: string;
  chapter: string;
}): Promise<{ path: string } | { downloaded: string }> {
  const base = safeFilename(opts.chapter);
  const filename = `${base}.${opts.format}`;
  const bytes =
    opts.format === "docx"
      ? await buildDocxBytes(opts.markdown, {
          subject: opts.subject,
          chapter: opts.chapter,
        })
      : await buildPdfBytes(opts.markdown, {
          subject: opts.subject,
          chapter: opts.chapter,
        });

  if (!isTauri()) {
    downloadInBrowser(
      filename,
      bytes,
      opts.format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf",
    );
    return { downloaded: filename };
  }

  const path = await save({
    defaultPath: filename,
    filters:
      opts.format === "docx"
        ? [{ name: "Word (DOCX)", extensions: ["docx"] }]
        : [{ name: "PDF", extensions: ["pdf"] }],
    title:
      opts.format === "docx" ? "Экспорт в DOCX" : "Экспорт в PDF",
  });

  if (!path) {
    throw new Error("Экспорт отменён");
  }

  await invoke("write_export_file", {
    path,
    dataBase64: bytesToBase64(bytes),
  });

  return { path };
}
