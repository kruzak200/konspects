import { jsPDF } from "jspdf";
import fontNormalUrl from "../../assets/fonts/DejaVuSans.ttf?url";
import fontBoldUrl from "../../assets/fonts/DejaVuSans-Bold.ttf?url";
import fontItalicUrl from "../../assets/fonts/DejaVuSans-Oblique.ttf?url";
import {
  parseExportBlocks,
  runsToPlain,
  type ExportBlock,
  type InlineRun,
} from "./model";
import {
  bytesToDataUri,
  pdfImageFormat,
  pdfSizeMm,
  resolveExportImage,
} from "./imageEmbed";

const FONT = "DejaVuSans";

async function arrayBufferToBase64(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function registerFonts(doc: jsPDF): Promise<void> {
  const specs: Array<{ url: string; style: "normal" | "bold" | "italic" }> = [
    { url: fontNormalUrl, style: "normal" },
    { url: fontBoldUrl, style: "bold" },
    { url: fontItalicUrl, style: "italic" },
  ];
  for (const spec of specs) {
    const res = await fetch(spec.url);
    if (!res.ok) throw new Error("Не удалось загрузить шрифт для PDF");
    const b64 = await arrayBufferToBase64(await res.arrayBuffer());
    const file = `${FONT}-${spec.style}.ttf`;
    doc.addFileToVFS(file, b64);
    doc.addFont(file, FONT, spec.style);
  }
}

function setRunFont(doc: jsPDF, run: InlineRun, size: number) {
  const style =
    run.bold && run.italic
      ? "bold"
      : run.bold
        ? "bold"
        : run.italic
          ? "italic"
          : "normal";
  // DejaVu bold-italic not bundled; prefer bold when both
  doc.setFont(FONT, style === "italic" && run.bold ? "bold" : style);
  doc.setFontSize(size);
}

type Cursor = { x: number; y: number; maxW: number; pageH: number; margin: number };

function ensureSpace(doc: jsPDF, cur: Cursor, need: number) {
  if (cur.y + need > cur.pageH - cur.margin) {
    doc.addPage();
    cur.y = cur.margin;
  }
}

function drawRuns(
  doc: jsPDF,
  cur: Cursor,
  runs: InlineRun[],
  size: number,
  lineH: number,
) {
  let lineX = cur.x;
  const startX = cur.x;

  const flushBreak = () => {
    cur.y += lineH;
    lineX = startX;
    ensureSpace(doc, cur, lineH);
  };

  for (const run of runs) {
    const parts = run.text.split("\n");
    for (let pi = 0; pi < parts.length; pi++) {
      if (pi > 0) flushBreak();
      const words = parts[pi].split(/(\s+)/);
      for (const word of words) {
        if (!word) continue;
        setRunFont(doc, run, size);
        const w = doc.getTextWidth(word);
        if (lineX > startX && lineX + w > startX + cur.maxW) {
          flushBreak();
          setRunFont(doc, run, size);
        }
        doc.text(word, lineX, cur.y);
        lineX += w;
      }
    }
  }
  cur.y += lineH * 0.35;
}

function drawTable(
  doc: jsPDF,
  cur: Cursor,
  block: Extract<ExportBlock, { kind: "table" }>,
) {
  const colCount = Math.max(
    block.headers.length,
    ...block.rows.map((r) => r.length),
    1,
  );
  const colW = cur.maxW / colCount;
  const pad = 3;
  const rowH = 10;
  const allRows: InlineRun[][][] = [block.headers, ...block.rows];

  for (let ri = 0; ri < allRows.length; ri++) {
    ensureSpace(doc, cur, rowH + 2);
    const row = [...allRows[ri]];
    while (row.length < colCount) row.push([{ text: "" }]);
    const y0 = cur.y;

    for (let ci = 0; ci < colCount; ci++) {
      const x0 = cur.margin + ci * colW;
      doc.setDrawColor(180, 190, 184);
      if (ri === 0) {
        doc.setFillColor(227, 240, 236);
        doc.rect(x0, y0 - 5, colW, rowH, "FD");
      } else {
        doc.rect(x0, y0 - 5, colW, rowH, "S");
      }
      const text = runsToPlain(row[ci]).slice(0, 80);
      doc.setFont(FONT, ri === 0 ? "bold" : "normal");
      doc.setFontSize(9);
      doc.setTextColor(28, 36, 48);
      doc.text(text, x0 + pad, y0, {
        maxWidth: colW - pad * 2,
      });
    }
    cur.y = y0 + rowH + 2;
  }
  cur.y += 4;
}

async function drawBlocks(
  doc: jsPDF,
  cur: Cursor,
  blocks: ExportBlock[],
  chapterPath: string | null,
) {
  for (const block of blocks) {
    if (block.kind === "heading") {
      const sizes = { 1: 18, 2: 15, 3: 13 } as const;
      const size = sizes[block.level];
      ensureSpace(doc, cur, size + 6);
      cur.y += 4;
      drawRuns(
        doc,
        cur,
        block.runs.map((r) => ({ ...r, bold: true })),
        size,
        size * 0.55,
      );
      cur.y += 3;
      continue;
    }
    if (block.kind === "paragraph") {
      ensureSpace(doc, cur, 12);
      drawRuns(doc, cur, block.runs, 11, 6.2);
      cur.y += 4;
      continue;
    }
    if (block.kind === "list") {
      block.items.forEach((item, i) => {
        const prefix = block.ordered ? `${i + 1}. ` : "• ";
        ensureSpace(doc, cur, 12);
        drawRuns(doc, cur, [{ text: prefix }, ...item], 11, 6.2);
        cur.y += 2;
      });
      cur.y += 3;
      continue;
    }
    if (block.kind === "table") {
      drawTable(doc, cur, block);
      continue;
    }
    if (block.kind === "image") {
      const img = await resolveExportImage(
        block.src,
        block.alt,
        chapterPath,
      );
      if (!img) {
        ensureSpace(doc, cur, 12);
        doc.setFont(FONT, "italic");
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(
          block.alt ? `[картинка не найдена: ${block.alt}]` : "[картинка не найдена]",
          cur.margin,
          cur.y,
        );
        cur.y += 8;
        doc.setTextColor(28, 36, 48);
        continue;
      }
      const format = pdfImageFormat(img.mime);
      const size = pdfSizeMm(img);
      if (!format) {
        ensureSpace(doc, cur, 12);
        doc.setFont(FONT, "italic");
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(
          `[картинка пропущена в PDF: ${img.alt || "GIF"}]`,
          cur.margin,
          cur.y,
        );
        cur.y += 8;
        doc.setTextColor(28, 36, 48);
        continue;
      }
      ensureSpace(doc, cur, size.h + 6);
      try {
        doc.addImage(
          bytesToDataUri(img.bytes, img.mime),
          format,
          cur.margin,
          cur.y,
          size.w,
          size.h,
        );
        cur.y += size.h + 6;
      } catch {
        doc.setFont(FONT, "italic");
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text(`[не удалось вставить картинку: ${img.alt}]`, cur.margin, cur.y);
        cur.y += 8;
        doc.setTextColor(28, 36, 48);
      }
    }
  }
}

export async function buildPdfBytes(
  markdown: string,
  meta: { subject: string; chapter: string; chapterPath?: string | null },
): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  await registerFonts(doc);
  doc.setFont(FONT, "normal");
  doc.setTextColor(28, 36, 48);

  const margin = 18;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const cur: Cursor = {
    x: margin,
    y: margin + 4,
    maxW: pageW - margin * 2,
    pageH,
    margin,
  };

  doc.setFont(FONT, "bold");
  doc.setFontSize(10);
  doc.setTextColor(31, 111, 106);
  doc.text(meta.subject, margin, cur.y);
  cur.y += 8;

  doc.setTextColor(28, 36, 48);
  doc.setFontSize(18);
  doc.text(meta.chapter, margin, cur.y);
  cur.y += 12;

  const blocks = parseExportBlocks(markdown);
  if (!blocks.length) {
    doc.setFont(FONT, "italic");
    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    doc.text("Пустой конспект", margin, cur.y);
  } else {
    await drawBlocks(doc, cur, blocks, meta.chapterPath ?? null);
  }

  const output = doc.output("arraybuffer");
  return new Uint8Array(output);
}
