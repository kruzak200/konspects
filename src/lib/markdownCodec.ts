import { marked } from "marked";
import TurndownService from "turndown";
// @ts-expect-error no types shipped for plugin entry
import { gfm, tables } from "turndown-plugin-gfm";

marked.setOptions({
  gfm: true,
  breaks: false,
});

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
});

turndown.use(gfm);
turndown.use(tables);

/**
 * TipTap wraps table cells in <p> and adds colgroup/styles — that breaks
 * turndown-plugin-gfm. Flatten cells so we get clean GFM pipe tables.
 * Pure string transforms (works in browser and Node).
 */
function normalizeEditorHtml(html: string): string {
  let out = html;
  out = out.replace(/<colgroup[\s\S]*?<\/colgroup>/gi, "");
  // Unwrap one or more <p>…</p> directly inside th/td (TipTap default).
  out = out.replace(
    /<(th|td)(\b[^>]*)>([\s\S]*?)<\/\1>/gi,
    (_full, tag: string, attrs: string, inner: string) => {
      let cell = inner
        .replace(/<\/?p\b[^>]*>/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      const cleanAttrs = attrs
        .replace(/\s(style|class|colwidth|colspan|rowspan)=["'][^"']*["']/gi, "")
        .replace(/\s(style|class|colwidth|colspan|rowspan)=[^\s>]+/gi, "");
      return `<${tag}${cleanAttrs}>${cell}</${tag}>`;
    },
  );
  out = out.replace(/\s(style|class)=["'][^"']*["']/gi, "");
  return out;
}

/** Markdown → HTML for TipTap / read view */
export function markdownToHtml(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return "<p></p>";
  return marked.parse(trimmed, { async: false }) as string;
}

/** TipTap HTML → Markdown (GFM tables) for disk */
export function htmlToMarkdown(html: string): string {
  const normalized = normalizeEditorHtml(html || "");
  const md = turndown.turndown(normalized);
  return md.replace(/\n{3,}/g, "\n\n").trim() + (md.trim() ? "\n" : "");
}

/**
 * If saved Markdown still embeds a raw <table>…</table> (legacy), convert
 * that HTML island to GFM before export.
 */
export function sanitizeChapterMarkdown(markdown: string): string {
  if (!markdown.includes("<table")) return markdown;
  let result = markdown;
  const re = /<table\b[\s\S]*?<\/table>/gi;
  result = result.replace(re, (raw) => {
    const asMd = htmlToMarkdown(raw).trim();
    return asMd ? `\n\n${asMd}\n\n` : "";
  });
  return result.replace(/\n{3,}/g, "\n\n").trim() + (result.trim() ? "\n" : "");
}
