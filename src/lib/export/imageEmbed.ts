import { loadImageForExport, type LoadedImageBytes } from "../images";

const MAX_DOC_WIDTH_PX = 520;
const MAX_PDF_WIDTH_MM = 160;

export type EmbedImage = {
  bytes: Uint8Array;
  mime: LoadedImageBytes["mime"];
  widthPx: number;
  heightPx: number;
  alt: string;
};

async function probeSize(
  bytes: Uint8Array,
  mime: string,
): Promise<{ width: number; height: number }> {
  try {
    const blob = new Blob([bytes], { type: mime });
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 800, height: 600 };
  }
}

function scaleTo(width: number, height: number, maxW: number) {
  if (width <= maxW) return { width, height };
  const scale = maxW / width;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function resolveExportImage(
  src: string,
  alt: string,
  chapterPath: string | null,
): Promise<EmbedImage | null> {
  const loaded = await loadImageForExport(src, chapterPath);
  if (!loaded) return null;
  const size = await probeSize(loaded.bytes, loaded.mime);
  const scaled = scaleTo(size.width, size.height, MAX_DOC_WIDTH_PX);
  return {
    bytes: loaded.bytes,
    mime: loaded.mime,
    widthPx: scaled.width,
    heightPx: scaled.height,
    alt: alt || "изображение",
  };
}

export function pdfSizeMm(img: EmbedImage): { w: number; h: number } {
  // ~96 dpi → mm
  const wMm = (img.widthPx * 25.4) / 96;
  const hMm = (img.heightPx * 25.4) / 96;
  if (wMm <= MAX_PDF_WIDTH_MM) return { w: wMm, h: hMm };
  const scale = MAX_PDF_WIDTH_MM / wMm;
  return { w: MAX_PDF_WIDTH_MM, h: hMm * scale };
}

export function docxImageType(
  mime: LoadedImageBytes["mime"],
): "jpg" | "png" | "gif" | "bmp" {
  if (mime === "image/png") return "png";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

export function pdfImageFormat(
  mime: LoadedImageBytes["mime"],
): "JPEG" | "PNG" | "WEBP" | null {
  if (mime === "image/jpeg") return "JPEG";
  if (mime === "image/png") return "PNG";
  if (mime === "image/webp") return "WEBP";
  // GIF: jspdf may not accept; caller can skip
  return null;
}

export function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
