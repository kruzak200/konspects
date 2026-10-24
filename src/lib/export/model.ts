import { marked, type Token, type Tokens } from "marked";
import { sanitizeChapterMarkdown } from "../markdownCodec";

export type InlineRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
};

export type ExportBlock =
  | { kind: "heading"; level: 1 | 2 | 3; runs: InlineRun[] }
  | { kind: "paragraph"; runs: InlineRun[] }
  | { kind: "list"; ordered: boolean; items: InlineRun[][] }
  | { kind: "table"; headers: InlineRun[][]; rows: InlineRun[][][] }
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

function cellRuns(cell: Tokens.TableCell): InlineRun[] {
  if (cell.tokens?.length) return inlineRuns(cell.tokens);
  return cell.text ? [{ text: cell.text }] : [{ text: "" }];
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

/** Parse Markdown into export-friendly blocks (incl. images). */
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
