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

/** Keep text-align so read/edit round-trips through Markdown. */
turndown.addRule("alignedBlock", {
  filter(node: HTMLElement) {
    const tag = node.nodeName;
    if (!["P", "H1", "H2", "H3"].includes(tag)) return false;
    const align = (node.getAttribute("style") || "").match(
      /text-align\s*:\s*(left|right|center|justify)/i,
    );
    return Boolean(align);
  },
  replacement(_content: string, node: HTMLElement) {
    const match = (node.getAttribute("style") || "").match(
      /text-align\s*:\s*(left|right|center|justify)/i,
    );
    const align = match?.[1]?.toLowerCase() ?? "left";
    const tag = node.nodeName.toLowerCase();
    // Keep inline HTML (<strong>, <em>) — not Markdown — inside the tag
    // so marked/TipTap can load it again.
    const inner = node.innerHTML.trim();
    return `\n\n<${tag} style="text-align:${align}">${inner}</${tag}>\n\n`;
  },
});

/**
 * TipTap wraps table cells in <p> and adds colgroup/styles — that breaks
 * turndown-plugin-gfm. Flatten cells so we get clean GFM pipe tables.
 * Preserve text-align on block elements.
 */
function normalizeEditorHtml(html: string): string {
  let out = html;
  out = out.replace(/<colgroup[\s\S]*?<\/colgroup>/gi, "");
  out = out.replace(
    /<(th|td)(\b[^>]*)>([\s\S]*?)<\/\1>/gi,
    (_full, tag: string, attrs: string, inner: string) => {
      const cell = inner
        .replace(/<\/?p\b[^>]*>/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      const cleanAttrs = attrs
        .replace(/\s(style|class|colwidth|colspan|rowspan)=["'][^"']*["']/gi, "")
        .replace(/\s(style|class|colwidth|colspan|rowspan)=[^\s>]+/gi, "");
      return `<${tag}${cleanAttrs}>${cell}</${tag}>`;
    },
  );

  out = out.replace(
    /<(p|h1|h2|h3)(\b[^>]*)>/gi,
    (_full, tag: string, attrs: string) => {
      const styleMatch = attrs.match(/style=["']([^"']*)["']/i);
      const align = styleMatch?.[1]?.match(
        /text-align\s*:\s*(left|right|center|justify)/i,
      )?.[1];
      const cleaned = attrs
        .replace(/\sstyle=["'][^"']*["']/gi, "")
        .replace(/\sclass=["'][^"']*["']/gi, "");
      if (align) {
        return `<${tag}${cleaned} style="text-align:${align.toLowerCase()}">`;
      }
      return `<${tag}${cleaned}>`;
    },
  );

  return out;
}

/** Markdown → HTML for TipTap / read view */
export function markdownToHtml(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return "<p></p>";
  return marked.parse(trimmed, { async: false }) as string;
}

/** TipTap HTML → Markdown (GFM tables + text-align) for disk */
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
