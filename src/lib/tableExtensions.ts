import { TableView } from "@tiptap/extension-table";
import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorView, NodeView, ViewMutationRecord } from "@tiptap/pm/view";

export type CellAlign = "left" | "center" | "right";

/**
 * Like TipTap TableView, but keeps the table at 100% width so only
 * internal column proportions change (outer left/right edges stay put).
 */
function updateColumnsFixed(
  node: ProseMirrorNode,
  colgroup: HTMLTableColElement,
  table: HTMLTableElement,
  cellMinWidth: number,
  overrideCol?: number,
  overrideValue?: number,
) {
  let totalWidth = 0;
  let nextDOM = colgroup.firstChild as HTMLElement | null;
  const row = node.firstChild;
  const widths: number[] = [];

  if (row !== null) {
    for (let i = 0, col = 0; i < row.childCount; i += 1) {
      const { colspan, colwidth } = row.child(i).attrs as {
        colspan: number;
        colwidth: number[] | null;
      };
      for (let j = 0; j < colspan; j += 1, col += 1) {
        const hasWidth =
          overrideCol === col ? overrideValue : colwidth && colwidth[j];
        const w = (hasWidth as number) || cellMinWidth;
        widths.push(w);
        totalWidth += w;
      }
    }
  }

  for (let col = 0; col < widths.length; col += 1) {
    const pct =
      totalWidth > 0
        ? Math.max(4, Math.round((widths[col] / totalWidth) * 1000) / 10)
        : Math.round(100 / Math.max(widths.length, 1));
    if (!nextDOM) {
      const colElement = document.createElement("col");
      colElement.style.width = `${pct}%`;
      colgroup.appendChild(colElement);
    } else {
      nextDOM.style.width = `${pct}%`;
      nextDOM.style.minWidth = "";
      nextDOM = nextDOM.nextSibling as HTMLElement | null;
    }
  }

  while (nextDOM) {
    const after = nextDOM.nextSibling as HTMLElement | null;
    nextDOM.parentNode?.removeChild(nextDOM);
    nextDOM = after;
  }

  table.style.width = "100%";
  table.style.minWidth = "";
  table.style.maxWidth = "100%";
  table.style.tableLayout = "fixed";
}

export class FixedEdgeTableView implements NodeView {
  node: ProseMirrorNode;
  cellMinWidth: number;
  dom: HTMLElement;
  table: HTMLTableElement;
  colgroup: HTMLTableColElement;
  contentDOM: HTMLElement;

  constructor(
    node: ProseMirrorNode,
    cellMinWidth: number,
    _view: EditorView,
    HTMLAttributes: Record<string, unknown> = {},
  ) {
    this.node = node;
    this.cellMinWidth = cellMinWidth;
    this.dom = document.createElement("div");
    this.dom.className = "tableWrapper";
    this.table = this.dom.appendChild(document.createElement("table"));
    for (const [key, value] of Object.entries(HTMLAttributes)) {
      if (value === undefined || value === null) continue;
      if (key === "style") this.table.style.cssText = String(value);
      else this.table.setAttribute(key, String(value));
    }
    if (node.attrs.style) this.table.style.cssText = String(node.attrs.style);
    this.colgroup = this.table.appendChild(
      document.createElement("colgroup"),
    ) as HTMLTableColElement;
    updateColumnsFixed(node, this.colgroup, this.table, cellMinWidth);
    this.contentDOM = this.table.appendChild(document.createElement("tbody"));
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    updateColumnsFixed(node, this.colgroup, this.table, this.cellMinWidth);
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    const target = mutation.target as Node;
    const isInsideWrapper = this.dom.contains(target);
    const isInsideContent = this.contentDOM.contains(target);
    if (isInsideWrapper && !isInsideContent) {
      if (
        mutation.type === "attributes" ||
        mutation.type === "childList" ||
        mutation.type === "characterData"
      ) {
        return true;
      }
    }
    return false;
  }
}

/** Compatible constructor for Table.configure({ View }). */
export const FixedEdgeTableViewCtor =
  FixedEdgeTableView as unknown as typeof TableView;

function posInTable(editor: Editor, pos: number): boolean {
  const $pos = editor.state.doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d -= 1) {
    if ($pos.node(d).type.name === "table") return true;
  }
  return false;
}

/** Section-wide align: skip paragraphs/headings inside tables. */
export function setDocumentAlignOutsideTables(
  editor: Editor,
  align: "left" | "center" | "justify",
) {
  const { state } = editor;
  let tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") {
      return;
    }
    if (posInTable(editor, pos)) return;
    tr = tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      textAlign: align,
    });
  });
  editor.view.dispatch(tr);
  editor.commands.focus();
}

export function currentDocAlignOutsideTables(editor: Editor): string | null {
  let found: string | null = null;
  let mixed = false;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") {
      return;
    }
    if (posInTable(editor, pos)) return;
    const a = (node.attrs.textAlign as string) || "justify";
    if (found === null) found = a;
    else if (found !== a) mixed = true;
  });
  return mixed ? null : found;
}

/** Align text inside selected / active table cells (+ nested paragraphs). */
export function setSelectedCellsAlign(editor: Editor, align: CellAlign) {
  editor.chain().focus().setCellAttribute("align", align).run();

  const { state } = editor;
  const { selection } = state;
  let tr = state.tr;
  const seen = new Set<number>();

  const applyAt = (cellPos: number) => {
    const cell = state.doc.nodeAt(cellPos);
    if (
      !cell ||
      (cell.type.name !== "tableCell" && cell.type.name !== "tableHeader")
    ) {
      return;
    }
    cell.descendants((node, rel) => {
      if (node.type.name !== "paragraph" && node.type.name !== "heading") {
        return;
      }
      const abs = cellPos + 1 + rel;
      if (seen.has(abs)) return;
      seen.add(abs);
      tr = tr.setNodeMarkup(abs, undefined, {
        ...node.attrs,
        textAlign: align,
      });
    });
  };

  const sel = selection as {
    forEachCell?: (fn: (node: ProseMirrorNode, pos: number) => void) => void;
  };
  if (typeof sel.forEachCell === "function") {
    sel.forEachCell((_node, pos) => applyAt(pos));
  } else {
    const $from = selection.$from;
    for (let d = $from.depth; d > 0; d -= 1) {
      const n = $from.node(d);
      if (n.type.name === "tableCell" || n.type.name === "tableHeader") {
        applyAt($from.before(d));
        break;
      }
    }
  }

  if (tr.docChanged) editor.view.dispatch(tr);
}

export function currentCellAlign(editor: Editor): CellAlign | null {
  if (!editor.isActive("table")) return null;
  const raw =
    (editor.getAttributes("tableCell").align as string | null | undefined) ??
    (editor.getAttributes("tableHeader").align as string | null | undefined);
  if (raw === "center" || raw === "right" || raw === "left") return raw;
  // TipTap default null → we treat as left (CSS default)
  return "left";
}

export function canMergeCells(editor: Editor): boolean {
  return editor.can().mergeCells();
}

export function canSplitCell(editor: Editor): boolean {
  return editor.can().splitCell();
}
