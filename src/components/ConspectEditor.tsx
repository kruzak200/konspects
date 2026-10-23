import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { useEffect } from "react";
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
      <EditorContent editor={editor} />
    </div>
  );
}
