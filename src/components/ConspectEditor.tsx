import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdownCodec";

type Props = {
  /** Remount / reset editor when this changes (e.g. chapter id + cancel counter) */
  resetKey: string;
  initialMarkdown: string;
  onChangeMarkdown: (md: string) => void;
  disabled?: boolean;
};

function ToolBtn({
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`edit-tool${active ? " is-active" : ""}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ToolSep() {
  return <span className="edit-tool-sep" aria-hidden="true" />;
}

/** Apply alignment to every paragraph/heading in the section (book-like). */
function setDocumentAlign(
  editor: Editor,
  align: "left" | "center" | "justify",
) {
  const { state } = editor;
  let tr = state.tr;
  state.doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") {
      tr = tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        textAlign: align,
      });
    }
  });
  editor.view.dispatch(tr);
  editor.commands.focus();
}

function currentDocAlign(editor: Editor): string | null {
  let found: string | null = null;
  let mixed = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph" || node.type.name === "heading") {
      const a = (node.attrs.textAlign as string) || "justify";
      if (found === null) found = a;
      else if (found !== a) mixed = true;
    }
  });
  return mixed ? null : found;
}

export function ConspectEditor({
  resetKey,
  initialMarkdown,
  onChangeMarkdown,
  disabled,
}: Props) {
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          codeBlock: false,
          code: false,
          blockquote: false,
          horizontalRule: false,
        }),
        TextAlign.configure({
          types: ["heading", "paragraph"],
          alignments: ["left", "center", "justify"],
          defaultAlignment: "justify",
        }),
        Placeholder.configure({
          placeholder:
            "Вставьте конспект из Merlin или начните править… Enter — новый абзац.",
        }),
        Table.configure({
          resizable: true,
          HTMLAttributes: { class: "conspect-table" },
        }),
        TableRow,
        TableHeader,
        TableCell,
      ],
      content: markdownToHtml(initialMarkdown),
      editable: !disabled,
      onUpdate: ({ editor: ed }) => {
        onChangeMarkdown(htmlToMarkdown(ed.getHTML()));
      },
      editorProps: {
        attributes: {
          class: "conspect-prose",
          spellcheck: "true",
          lang: "ru",
        },
      },
    },
    [resetKey],
  );

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  if (!editor) return null;

  const inTable = editor.isActive("table");
  const docAlign = currentDocAlign(editor);

  return (
    <div className={`rich-editor${disabled ? " is-disabled" : ""}`}>
      <div className="edit-toolbar" role="toolbar" aria-label="Форматирование">
        <ToolBtn
          label="Ж"
          title="Жирный"
          active={editor.isActive("bold")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolBtn
          label="К"
          title="Курсив"
          active={editor.isActive("italic")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolSep />
        <ToolBtn
          label="Абз"
          title="Обычный абзац"
          active={editor.isActive("paragraph")}
          disabled={disabled}
          onClick={() => editor.chain().focus().setParagraph().run()}
        />
        <ToolBtn
          label="З1"
          title="Заголовок 1"
          active={editor.isActive("heading", { level: 1 })}
          disabled={disabled}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        />
        <ToolBtn
          label="З2"
          title="Заголовок 2"
          active={editor.isActive("heading", { level: 2 })}
          disabled={disabled}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        />
        <ToolBtn
          label="З3"
          title="Заголовок 3"
          active={editor.isActive("heading", { level: 3 })}
          disabled={disabled}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
        />
        <ToolSep />
        <ToolBtn
          label="По ширине"
          title="Выровнять текст по ширине (как в книге)"
          active={docAlign === "justify"}
          disabled={disabled}
          onClick={() => setDocumentAlign(editor, "justify")}
        />
        <ToolBtn
          label="По левому"
          title="По левому краю"
          active={docAlign === "left"}
          disabled={disabled}
          onClick={() => setDocumentAlign(editor, "left")}
        />
        <ToolBtn
          label="По центру"
          title="По центру"
          active={docAlign === "center"}
          disabled={disabled}
          onClick={() => setDocumentAlign(editor, "center")}
        />
        <ToolSep />
        <ToolBtn
          label="• Список"
          title="Маркированный список"
          active={editor.isActive("bulletList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolSep />
        <ToolBtn
          label="Таблица"
          title="Вставить таблицу 3×3"
          disabled={disabled}
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        />
        {inTable && (
          <>
            <ToolBtn
              label="+ряд"
              title="Добавить строку"
              disabled={disabled}
              onClick={() => editor.chain().focus().addRowAfter().run()}
            />
            <ToolBtn
              label="−ряд"
              title="Удалить строку"
              disabled={disabled}
              onClick={() => editor.chain().focus().deleteRow().run()}
            />
            <ToolBtn
              label="+стлб"
              title="Добавить столбец"
              disabled={disabled}
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            />
            <ToolBtn
              label="−стлб"
              title="Удалить столбец"
              disabled={disabled}
              onClick={() => editor.chain().focus().deleteColumn().run()}
            />
            <ToolBtn
              label="×табл"
              title="Удалить таблицу"
              disabled={disabled}
              onClick={() => editor.chain().focus().deleteTable().run()}
            />
          </>
        )}
      </div>
      <div className="text-column">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
