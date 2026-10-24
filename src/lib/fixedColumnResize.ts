import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TableMap, cellAround } from "@tiptap/pm/tables";

/**
 * Column resize with fixed outer edges: dragging the border between
 * column i and i+1 transfers width (i grows, i+1 shrinks by the same amount).
 * Live preview and commit use the same share math — no jump on mouse-up.
 */

const key = new PluginKey("konspectsFixedColResize");

type DragState = {
  tablePos: number;
  leftCol: number;
  startX: number;
  startShares: number[];
  tableWidthPx: number;
};

type PluginState = {
  hoverCol: number;
  dragging: DragState | null;
};

const HANDLE_HIT = 6;
const MIN_SHARE = 0.06;

function findTableDom(
  view: EditorView,
  tablePos: number,
): HTMLTableElement | null {
  const dom = view.nodeDOM(tablePos);
  if (!dom || !(dom instanceof HTMLElement)) return null;
  if (dom.nodeName === "TABLE") return dom as HTMLTableElement;
  return dom.querySelector("table");
}

function colgroupOf(table: HTMLTableElement): HTMLTableColElement | null {
  return table.querySelector(":scope > colgroup");
}

function columnShares(table: ProseMirrorNode): number[] {
  const map = TableMap.get(table);
  const widths: number[] = Array(map.width).fill(0);
  const row = table.firstChild;
  if (!row) return widths.map(() => 1 / Math.max(map.width, 1));

  for (let i = 0, col = 0; i < row.childCount; i++) {
    const cell = row.child(i);
    const { colspan, colwidth } = cell.attrs as {
      colspan: number;
      colwidth: number[] | null;
    };
    for (let j = 0; j < colspan; j++, col++) {
      widths[col] = (colwidth && colwidth[j]) || 0;
    }
  }

  const sum = widths.reduce((a, b) => a + b, 0);
  if (sum <= 0) return widths.map(() => 1 / map.width);
  return widths.map((w) => w / sum);
}

function applySharesToDom(tableEl: HTMLTableElement, shares: number[]) {
  const colgroup = colgroupOf(tableEl);
  if (!colgroup) return;
  let col = colgroup.firstChild as HTMLElement | null;
  for (let i = 0; i < shares.length; i++) {
    const pct = Math.round(shares[i] * 1000) / 10;
    if (!col) {
      const el = document.createElement("col");
      el.style.width = `${pct}%`;
      colgroup.appendChild(el);
    } else {
      col.style.width = `${pct}%`;
      col.style.minWidth = "";
      col = col.nextSibling as HTMLElement | null;
    }
  }
  while (col) {
    const next = col.nextSibling as HTMLElement | null;
    col.parentNode?.removeChild(col);
    col = next;
  }
  tableEl.style.width = "100%";
  tableEl.style.minWidth = "";
  tableEl.style.maxWidth = "100%";
  tableEl.style.tableLayout = "fixed";
}

function commitShares(
  view: EditorView,
  tablePos: number,
  table: ProseMirrorNode,
  shares: number[],
  refWidthPx: number,
) {
  const map = TableMap.get(table);
  const start = tablePos + 1;
  const px = shares.map((s) =>
    Math.max(24, Math.round(s * Math.max(refWidthPx, 200))),
  );
  let tr = view.state.tr;

  for (let row = 0; row < map.height; row++) {
    for (let col = 0; col < map.width; ) {
      const mapIndex = row * map.width + col;
      if (row && map.map[mapIndex] === map.map[mapIndex - map.width]) {
        col += 1;
        continue;
      }
      const pos = map.map[mapIndex];
      const cell = table.nodeAt(pos);
      if (!cell) {
        col += 1;
        continue;
      }
      const colspan = cell.attrs.colspan as number;
      const colwidth = Array.from({ length: colspan }, (_, j) => px[col + j]);
      const prev = cell.attrs.colwidth as number[] | null;
      const same =
        Array.isArray(prev) &&
        prev.length === colwidth.length &&
        prev.every((v, i) => v === colwidth[i]);
      if (!same) {
        tr = tr.setNodeMarkup(start + pos, null, {
          ...cell.attrs,
          colwidth,
        });
      }
      col += colspan;
    }
  }

  if (tr.docChanged) view.dispatch(tr);
}

function borderAt(
  view: EditorView,
  event: MouseEvent,
): { tablePos: number; leftCol: number } | null {
  const target = event.target as HTMLElement | null;
  if (!target) return null;
  const cellEl = target.closest("td, th") as HTMLElement | null;
  if (!cellEl) return null;
  const rect = cellEl.getBoundingClientRect();
  const nearRight = rect.right - event.clientX <= HANDLE_HIT;
  const nearLeft = event.clientX - rect.left <= HANDLE_HIT;
  if (!nearRight && !nearLeft) return null;

  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return null;
  const $cell = cellAround(view.state.doc.resolve(coords.pos));
  if (!$cell) return null;
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const tableStart = $cell.start(-1);
  const tablePos = tableStart - 1;
  const colIndex =
    map.colCount($cell.pos - tableStart) +
    ($cell.nodeAfter?.attrs.colspan ?? 1) -
    1;

  const leftCol = nearRight ? colIndex : colIndex - 1;
  if (leftCol < 0 || leftCol >= map.width - 1) return null;
  return { tablePos, leftCol };
}

function handleDecorations(
  state: import("@tiptap/pm/state").EditorState,
  hoverCol: number,
) {
  if (hoverCol < 0) return DecorationSet.empty;
  const decorations: ReturnType<typeof Decoration.widget>[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "table") return;
    const map = TableMap.get(node);
    if (hoverCol >= map.width - 1) return false;
    const start = pos + 1;
    for (let row = 0; row < map.height; row++) {
      const index = row * map.width + hoverCol;
      const cellPos = map.map[index];
      if (row && map.map[index] === map.map[index - map.width]) continue;
      const cellNode = node.nodeAt(cellPos);
      if (!cellNode) continue;
      const widgetPos = start + cellPos + cellNode.nodeSize - 1;
      const dom = document.createElement("div");
      dom.className = "column-resize-handle";
      decorations.push(Decoration.widget(widgetPos, dom));
    }
    return false;
  });
  return DecorationSet.create(state.doc, decorations);
}

type ViewExtra = EditorView & { __konspectsShares?: number[] };

export const FixedColumnResize = Extension.create({
  name: "fixedColumnResize",

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key,
        state: {
          init: () => ({ hoverCol: -1, dragging: null }),
          apply(tr, prev) {
            const meta = tr.getMeta(key) as Partial<PluginState> | undefined;
            if (!meta) return prev;
            return { ...prev, ...meta };
          },
        },
        props: {
          attributes(state) {
            const ps = key.getState(state);
            if (ps?.dragging || (ps && ps.hoverCol >= 0)) {
              return { class: "resize-cursor" };
            }
            return { class: "" };
          },
          decorations(state) {
            const ps = key.getState(state);
            if (!ps || ps.hoverCol < 0) return DecorationSet.empty;
            return handleDecorations(state, ps.hoverCol);
          },
          handleDOMEvents: {
            mousemove(view, event) {
              if (!view.editable) return false;
              const ps = key.getState(view.state);
              if (ps?.dragging) return false;

              const hit = borderAt(view, event);
              const next = hit ? hit.leftCol : -1;
              if (ps && ps.hoverCol !== next) {
                view.dispatch(view.state.tr.setMeta(key, { hoverCol: next }));
              }
              return false;
            },
            mouseleave(view) {
              const ps = key.getState(view.state);
              if (ps && ps.hoverCol >= 0 && !ps.dragging) {
                view.dispatch(view.state.tr.setMeta(key, { hoverCol: -1 }));
              }
              return false;
            },
            mousedown(view, event) {
              if (!view.editable || event.button !== 0) return false;
              const hit = borderAt(view, event);
              if (!hit) return false;

              const table = view.state.doc.nodeAt(hit.tablePos);
              if (!table || table.type.name !== "table") return false;
              const tableEl = findTableDom(view, hit.tablePos);
              if (!tableEl) return false;

              const dragging: DragState = {
                tablePos: hit.tablePos,
                leftCol: hit.leftCol,
                startX: event.clientX,
                startShares: columnShares(table),
                tableWidthPx: tableEl.clientWidth || 600,
              };

              view.dispatch(
                view.state.tr.setMeta(key, {
                  dragging,
                  hoverCol: hit.leftCol,
                }),
              );

              const move = (ev: MouseEvent) => {
                const st = key.getState(view.state)?.dragging;
                if (!st) return;
                const dx = ev.clientX - st.startX;
                const delta = dx / st.tableWidthPx;
                const left = st.leftCol;
                const right = left + 1;
                const pair = st.startShares[left] + st.startShares[right];
                let newLeft = st.startShares[left] + delta;
                newLeft = Math.max(
                  MIN_SHARE,
                  Math.min(pair - MIN_SHARE, newLeft),
                );
                const next = [...st.startShares];
                next[left] = newLeft;
                next[right] = pair - newLeft;

                const el = findTableDom(view, st.tablePos);
                if (el) applySharesToDom(el, next);
                (view as ViewExtra).__konspectsShares = next;
              };

              const finish = (ev: MouseEvent) => {
                window.removeEventListener("mousemove", move);
                window.removeEventListener("mouseup", finish);
                const st = key.getState(view.state)?.dragging;
                if (!st) return;

                move(ev);
                const shares =
                  (view as ViewExtra).__konspectsShares || st.startShares;
                const tableNode = view.state.doc.nodeAt(st.tablePos);
                if (tableNode && tableNode.type.name === "table") {
                  commitShares(
                    view,
                    st.tablePos,
                    tableNode,
                    shares,
                    st.tableWidthPx,
                  );
                }
                view.dispatch(
                  view.state.tr.setMeta(key, { dragging: null, hoverCol: -1 }),
                );
                delete (view as ViewExtra).__konspectsShares;
              };

              window.addEventListener("mousemove", move);
              window.addEventListener("mouseup", finish);
              event.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },
});
