import { marked, type Token, type Tokens } from "marked";
import { sanitizeChapterMarkdown } from "../markdownCodec";

export type InlineRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
};

export type CellAlign = "left" | "center" | "right";

export type ExportTableCell = {
  runs: InlineRun[];
  align: CellAlign;
  colspan: number;
  rowspan: number;
  /** Relative width share when known (from colgroup / colwidth). */
  widthShare?: number;
};

export type ExportBlock =
  | { kind: "heading"; level: 1 | 2 | 3; runs: InlineRun[] }
  | { kind: "paragraph"; runs: InlineRun[] }
  | { kind: "list"; ordered: boolean; items: InlineRun[][] }
  | {
      kind: "table";
      headers: ExportTableCell[];
      rows: ExportTableCell[][];
      colShares?: number[];
    }
  | { kind: "image"; src: string; alt: string };

function inlineRuns(tokens: Token[] | undefined): InlineRun[] {
  if (!tokens?.length) return [];
  const runs: InlineRun[] = [];

  const walk = (list: Token[], bold = false, italic = false) => {
    for (const token of list) {
      if (token.type === "image") continue;
      if (token.type === "text") {
        const t = token as Tokens.Text;
        if (t.tokens?.length) {
          walk(t.tokens, bold, italic);
        } else if (t.text) {
          runs.push({ text: t.text, bold, italic });
        }
        continue;
      }
      if (token.type === "strong") {
        const t = token as Tokens.Strong;
        walk(t.tokens ?? [{ type: "text", text: t.text } as Tokens.Text], true, italic);
        continue;
      }
      if (token.type === "em") {
        const t = token as Tokens.Em;
        walk(t.tokens ?? [{ type: "text", text: t.text } as Tokens.Text], bold, true);
        continue;
      }
      if (token.type === "codespan") {
        const t = token as Tokens.Codespan;
        runs.push({ text: t.text, bold, italic });
        continue;
      }
      if (token.type === "br") {
        runs.push({ text: "\n", bold, italic });
        continue;
      }
      if (token.type === "escape" || token.type === "html") {
        const t = token as Tokens.Escape | Tokens.HTML;
        if ("text" in t && t.text) runs.push({ text: t.text, bold, italic });
        continue;
      }
      if ("tokens" in token && Array.isArray((token as { tokens?: Token[] }).tokens)) {
        walk((token as { tokens: Token[] }).tokens, bold, italic);
        continue;
      }
      if ("text" in token && typeof (token as { text?: string }).text === "string") {
        runs.push({ text: (token as { text: string }).text, bold, italic });
      }
    }
  };

  walk(tokens);
  return runs.filter((r) => r.text.length > 0);
}

function cellRuns(cell: Tokens.TableCell): ExportTableCell {
  const runs = cell.tokens?.length
    ? inlineRuns(cell.tokens)
    : cell.text
      ? [{ text: cell.text }]
      : [{ text: "" }];
  return { runs, align: "left", colspan: 1, rowspan: 1 };
}

function parseInlineHtml(html: string): InlineRun[] {
  const plain = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?strong\b[^>]*>/gi, (m) => (m.startsWith("</") ? "\u0002" : "\u0001"))
    .replace(/<\/?b\b[^>]*>/gi, (m) => (m.startsWith("</") ? "\u0002" : "\u0001"))
    .replace(/<\/?em\b[^>]*>/gi, (m) => (m.startsWith("</") ? "\u0004" : "\u0003"))
    .replace(/<\/?i\b[^>]*>/gi, (m) => (m.startsWith("</") ? "\u0004" : "\u0003"))
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');

  const runs: InlineRun[] = [];
  let bold = false;
  let italic = false;
  let buf = "";
  const flush = () => {
    if (!buf) return;
    runs.push({ text: buf, bold, italic });
    buf = "";
  };
  for (const ch of plain) {
    if (ch === "\u0001") {
      flush();
      bold = true;
      continue;
    }
    if (ch === "\u0002") {
      flush();
      bold = false;
      continue;
    }
    if (ch === "\u0003") {
      flush();
      italic = true;
      continue;
    }
    if (ch === "\u0004") {
      flush();
      italic = false;
      continue;
    }
    buf += ch;
  }
  flush();
  return runs.length ? runs : [{ text: "" }];
}

function htmlCellAlign(el: Element): CellAlign {
  const style = (el.getAttribute("style") || "").match(
    /text-align\s*:\s*(left|center|right)/i,
  )?.[1];
  const attr = el.getAttribute("align");
  const raw = (style || attr || "left").toLowerCase();
  if (raw === "center" || raw === "right") return raw;
  return "left";
}

function parseHtmlTable(html: string): Extract<ExportBlock, { kind: "table" }> | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;

  const colShares = Array.from(table.querySelectorAll(":scope > colgroup > col")).map(
    (col) => {
      const style = col.getAttribute("style") || "";
      const pct = style.match(/width\s*:\s*([\d.]+)\s*%/i)?.[1];
      if (pct) return parseFloat(pct);
      const px = style.match(/width\s*:\s*([\d.]+)\s*px/i)?.[1];
      return px ? parseFloat(px) : 0;
    },
  );

  const rows = Array.from(
    table.querySelectorAll(":scope > tbody > tr, :scope > thead > tr, :scope > tr"),
  );
  if (!rows.length) return null;

  const toCell = (el: Element): ExportTableCell => ({
    runs: parseInlineHtml(el.innerHTML),
    align: htmlCellAlign(el),
    colspan: Math.max(1, parseInt(el.getAttribute("colspan") || "1", 10) || 1),
    rowspan: Math.max(1, parseInt(el.getAttribute("rowspan") || "1", 10) || 1),
  });

  const first = rows[0];
  const headers = Array.from(first.children)
    .filter((c) => /^(TH|TD)$/i.test(c.tagName))
    .map(toCell);
  const bodyRows = rows.slice(1).map((tr) =>
    Array.from(tr.children)
      .filter((c) => /^(TH|TD)$/i.test(c.tagName))
      .map(toCell),
  );

  return {
    kind: "table",
    headers,
    rows: bodyRows,
    colShares: colShares.some((w) => w > 0) ? colShares : undefined,
  };
}

function pushParagraphOrImages(
  tokens: Token[] | undefined,
  fallbackText: string,
  blocks: ExportBlock[],
) {
  if (!tokens?.length) {
    if (fallbackText.trim()) {
      blocks.push({ kind: "paragraph", runs: [{ text: fallbackText }] });
    }
    return;
  }

  let buffer: Token[] = [];
  const flushText = () => {
    if (!buffer.length) return;
    const runs = inlineRuns(buffer);
    if (runs.some((r) => r.text.trim())) {
      blocks.push({ kind: "paragraph", runs });
    }
    buffer = [];
  };

  for (const tok of tokens) {
    if (tok.type === "image") {
      flushText();
      const img = tok as Tokens.Image;
      blocks.push({
        kind: "image",
        src: img.href || "",
        alt: img.text || "",
      });
      continue;
    }
    buffer.push(tok);
  }
  flushText();
}

function pushHtmlToken(raw: string, blocks: ExportBlock[]) {
  const trimmed = raw.trim();
  if (!trimmed) return;
  if (/^<table\b/i.test(trimmed)) {
    const table = parseHtmlTable(trimmed);
    if (table) {
      blocks.push(table);
      return;
    }
  }
  // Strip tags for unknown HTML islands
  const text = trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text) blocks.push({ kind: "paragraph", runs: [{ text }] });
}

/** Parse Markdown into export-friendly blocks (incl. images + HTML tables). */
export function parseExportBlocks(markdown: string): ExportBlock[] {
  const cleaned = sanitizeChapterMarkdown(
    markdown.replace(/\r\n/g, "\n").trim() || "",
  );
  const tokens = marked.lexer(cleaned);
  const blocks: ExportBlock[] = [];

  for (const token of tokens) {
    if (token.type === "heading") {
      const t = token as Tokens.Heading;
      const level = Math.min(3, Math.max(1, t.depth)) as 1 | 2 | 3;
      blocks.push({
        kind: "heading",
        level,
        runs: inlineRuns(t.tokens) || [{ text: t.text }],
      });
      continue;
    }
    if (token.type === "paragraph") {
      const t = token as Tokens.Paragraph;
      pushParagraphOrImages(t.tokens, t.text, blocks);
      continue;
    }
    if (token.type === "image") {
      const t = token as Tokens.Image;
      blocks.push({ kind: "image", src: t.href || "", alt: t.text || "" });
      continue;
    }
    if (token.type === "list") {
      const t = token as Tokens.List;
      const items: InlineRun[][] = t.items.map((item) => {
        if (item.tokens?.length) {
          const para = item.tokens.find((x) => x.type === "paragraph") as
            | Tokens.Paragraph
            | undefined;
          if (para?.tokens) return inlineRuns(para.tokens);
          return inlineRuns(item.tokens);
        }
        return item.text ? [{ text: item.text }] : [{ text: "" }];
      });
      blocks.push({ kind: "list", ordered: t.ordered, items });
      continue;
    }
    if (token.type === "table") {
      const t = token as Tokens.Table;
      blocks.push({
        kind: "table",
        headers: t.header.map(cellRuns),
        rows: t.rows.map((row) => row.map(cellRuns)),
      });
      continue;
    }
    if (token.type === "html") {
      const t = token as Tokens.HTML;
      pushHtmlToken(t.text || t.raw || "", blocks);
      continue;
    }
    if (token.type === "space") continue;
    if (token.type === "hr") continue;
    if (token.type === "blockquote") {
      const t = token as Tokens.Blockquote;
      const nested = parseExportBlocks(
        t.tokens?.map((x) => ("raw" in x ? x.raw : "")).join("") || t.text || "",
      );
      blocks.push(...nested);
      continue;
    }
    if ("text" in token && typeof (token as { text?: string }).text === "string") {
      const text = (token as { text: string }).text.trim();
      if (text) blocks.push({ kind: "paragraph", runs: [{ text }] });
    }
  }

  return blocks;
}

export function runsToPlain(runs: InlineRun[]): string {
  return runs.map((r) => r.text).join("");
}
