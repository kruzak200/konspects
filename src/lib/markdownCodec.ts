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

/** Markdown → HTML for TipTap / read view */
export function markdownToHtml(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return "<p></p>";
  return marked.parse(trimmed, { async: false }) as string;
}

/** TipTap HTML → Markdown (GFM tables) for disk */
export function htmlToMarkdown(html: string): string {
  const md = turndown.turndown(html || "");
  return md.replace(/\n{3,}/g, "\n\n").trim() + (md.trim() ? "\n" : "");
}
