import { marked } from "marked";
import TurndownService from "turndown";
// @ts-expect-error no types shipped for plugin entry
import { strikethrough, taskListItems } from "turndown-plugin-gfm";

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

// Keep HTML tables ourselves — do not use turndown-plugin-gfm `tables`
// (pipe tables cannot store merges, alignment, or column widths).
turndown.use([strikethrough, taskListItems]);

/** Keep text-align so read/edit round-trips through Markdown. */
turndown.addRule("alignedBlock", {
  filter(node: HTMLElement) {
    const tag = node.nodeName;
    if (!["P", "H1", "H2", "H3"].includes(tag)) return false;
    // Paragraphs inside tables are handled by the table serializer.
    if (node.closest("table")) return false;
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
    const inner = node.innerHTML.trim();
    return `\n\n<${tag} style="text-align:${align}">${inner}</${tag}>\n\n`;
  },
});

function cellAlign(el: Element): "left" | "center" | "right" | null {
  const style = (el.getAttribute("style") || "").match(
    /text-align\s*:\s*(left|center|right)/i,
  )?.[1];
  const attr = el.getAttribute("align");
  const raw = (style || attr || "").toLowerCase();
  if (raw === "center" || raw === "right" || raw === "left") return raw;
  return null;
}

function flattenCellInner(html: string): string {
  return html
    .replace(/<\/?p\b[^>]*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function serializeCell(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parts: string[] = [];
  const colspan = el.getAttribute("colspan");
  const rowspan = el.getAttribute("rowspan");
  const colwidth = el.getAttribute("colwidth");
  if (colspan && colspan !== "1") parts.push(`colspan="${colspan}"`);
  if (rowspan && rowspan !== "1") parts.push(`rowspan="${rowspan}"`);
  if (colwidth) parts.push(`colwidth="${colwidth}"`);
  const align = cellAlign(el);
  // Always emit left/center/right so Читать keeps left-friendly default explicit.
  parts.push(`style="text-align:${align ?? "left"}"`);
  const inner = flattenCellInner(el.innerHTML);
  const attr = parts.length ? ` ${parts.join(" ")}` : "";
  return `<${tag}${attr}>${inner}</${tag}>`;
}

/** Persist tables as HTML (alignment, merges, column widths). */
function serializeTable(table: HTMLTableElement): string {
  const cols = Array.from(table.querySelectorAll(":scope > colgroup > col"));
  let colgroup = "";
  if (cols.length) {
    const widths = cols.map((col) => {
      const style = col.getAttribute("style") || "";
      const pct = style.match(/width\s*:\s*([\d.]+)\s*%/i)?.[1];
      if (pct) return parseFloat(pct);
      const px = style.match(/width\s*:\s*([\d.]+)\s*px/i)?.[1];
      return px ? parseFloat(px) : 0;
    });
    const sum = widths.reduce((a, b) => a + b, 0);
    const asPct =
      sum > 0 && widths.some((w) => w > 0)
        ? widths.map((w) =>
            w > 0 ? Math.max(4, Math.round((w / sum) * 1000) / 10) : 0,
          )
        : widths;
    // Renormalize if we had zeros
    const pctSum = asPct.reduce((a, b) => a + b, 0) || 1;
    colgroup =
      "<colgroup>" +
      asPct
        .map((w) => {
          const pct = Math.round((w / pctSum) * 1000) / 10;
          return `<col style="width:${pct}%">`;
        })
        .join("") +
      "</colgroup>";
  }

  const rows = Array.from(table.querySelectorAll(":scope > tbody > tr, :scope > tr"));
  const body = rows
    .map((tr) => {
      const cells = Array.from(tr.children).filter((c) =>
        /^(TD|TH)$/i.test(c.tagName),
      );
      return `<tr>${cells.map(serializeCell).join("")}</tr>`;
    })
    .join("");

  return `<table class="conspect-table" style="width:100%;table-layout:fixed">${colgroup}${body}</table>`;
}

turndown.addRule("conspectTable", {
  filter: "table",
  replacement(_content: string, node: HTMLElement) {
    return `\n\n${serializeTable(node as HTMLTableElement)}\n\n`;
  },
});

/**
 * TipTap wraps table cells in <p> and adds transient classes.
 * Keep colspan/rowspan/colwidth/align; flatten inner paragraphs.
 */
function normalizeEditorHtml(html: string): string {
  let out = html;

  // Keep colgroup; only strip TipTap chrome classes on wrapper bits later.
  out = out.replace(
    /<(th|td)(\b[^>]*)>([\s\S]*?)<\/\1>/gi,
    (_full, tag: string, attrs: string, inner: string) => {
      const cell = flattenCellInner(inner);
      const colspan = attrs.match(/\scolspan=["']?(\d+)["']?/i)?.[1];
      const rowspan = attrs.match(/\srowspan=["']?(\d+)["']?/i)?.[1];
      const colwidth = attrs.match(/\scolwidth=["']([^"']+)["']/i)?.[1];
      const styleMatch = attrs.match(/\sstyle=["']([^"']*)["']/i)?.[1] || "";
      const align =
        styleMatch.match(/text-align\s*:\s*(left|center|right)/i)?.[1] ||
        attrs.match(/\salign=["'](left|center|right)["']/i)?.[1] ||
        "left";

      const parts: string[] = [];
      if (colspan && colspan !== "1") parts.push(`colspan="${colspan}"`);
      if (rowspan && rowspan !== "1") parts.push(`rowspan="${rowspan}"`);
      if (colwidth) parts.push(`colwidth="${colwidth}"`);
      parts.push(`style="text-align:${align.toLowerCase()}"`);
      return `<${tag} ${parts.join(" ")}>${cell}</${tag}>`;
    },
  );

  // Normalize col widths to % when possible (pixel sums → proportions).
  out = out.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (tableHtml) => {
    const doc = new DOMParser().parseFromString(tableHtml, "text/html");
    const table = doc.querySelector("table");
    if (!table) return tableHtml;
    return serializeTable(table);
  });

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

/** TipTap HTML → Markdown (HTML tables + text-align) for disk */
export function htmlToMarkdown(html: string): string {
  const normalized = normalizeEditorHtml(html || "");
  const md = turndown.turndown(normalized);
  return md.replace(/\n{3,}/g, "\n\n").trim() + (md.trim() ? "\n" : "");
}

/**
 * Normalize chapter markdown for export/display. Keep HTML tables intact
 * (merges, alignment, column widths). Convert only legacy bare tables that
 * somehow lack structure via identity (already HTML).
 */
export function sanitizeChapterMarkdown(markdown: string): string {
  // Previously this converted HTML tables → GFM and dropped merges/widths.
  // Keep HTML tables as-is; GFM pipe tables still work via marked.
  return markdown.replace(/\n{3,}/g, "\n\n").trim() + (markdown.trim() ? "\n" : "");
}
