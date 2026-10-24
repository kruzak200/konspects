import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import Image from "@tiptap/extension-image";
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { htmlToMarkdown, markdownToHtml } from "../lib/markdownCodec";
import {
  pickAndSaveImage,
  relativizeMarkdownImages,
  resolveMarkdownImages,
  savePastedImage,
} from "../lib/images";

type ImageContext = {
  subject: string;
  chapter: string;
  sectionId: string;
  chapterPath: string | null;
};

type Props = {
  /** Remount / reset editor when this changes (e.g. chapter id + cancel counter) */
  resetKey: string;
  initialMarkdown: string;
  onChangeMarkdown: (md: string) => void;
  disabled?: boolean;
  imageContext: ImageContext;
  onImageError?: (message: string) => void;
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

function toDiskMarkdown(html: string, chapterPath: string | null): string {
  return relativizeMarkdownImages(htmlToMarkdown(html), chapterPath);
}

export function ConspectEditor({
  resetKey,
  initialMarkdown,
  onChangeMarkdown,
  disabled,
  imageContext,
  onImageError,
}: Props) {
  const ctxRef = useRef(imageContext);
  ctxRef.current = imageContext;
  const errRef = useRef(onImageError);
  errRef.current = onImageError;
  const editorRef = useRef<Editor | null>(null);
  const [imageBusy, setImageBusy] = useState(false);

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
            "Вставьте конспект из Merlin или начните править… Enter — новый абзац. Картинку — кнопкой или Cmd/Ctrl+V.",
        }),
        Table.configure({
          resizable: true,
          HTMLAttributes: { class: "conspect-table" },
        }),
        TableRow,
        TableHeader,
        TableCell,
        Image.configure({
          inline: false,
          allowBase64: true,
          HTMLAttributes: { class: "conspect-image" },
        }),
      ],
      content: markdownToHtml(
        resolveMarkdownImages(initialMarkdown, imageContext.chapterPath),
      ),
      editable: !disabled,
      onUpdate: ({ editor: ed }) => {
        onChangeMarkdown(
          toDiskMarkdown(ed.getHTML(), ctxRef.current.chapterPath),
        );
      },
      editorProps: {
        attributes: {
          class: "conspect-prose",
          spellcheck: "true",
          lang: "ru",
        },
        handlePaste(_view, event) {
          const list = event.clipboardData?.items;
          if (!list) return false;
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (!item.type.startsWith("image/")) continue;
            const file = item.getAsFile();
            if (!file) continue;
            event.preventDefault();
            const ctx = ctxRef.current;
            void (async () => {
              try {
                setImageBusy(true);
                const saved = await savePastedImage({
                  subject: ctx.subject,
                  chapter: ctx.chapter,
                  sectionId: ctx.sectionId,
                  blob: file,
                });
                const ed = editorRef.current;
                if (!ed) return;
                ed.chain()
                  .focus()
                  .setImage({ src: saved.displaySrc, alt: "" })
                  .run();
              } catch (e) {
                const msg =
                  e instanceof Error
                    ? e.message
                    : "Не удалось вставить картинку";
                errRef.current?.(msg);
              } finally {
                setImageBusy(false);
              }
            })();
            return true;
          }
          return false;
        },
      },
    },
    [resetKey],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  async function insertImageFromFile() {
    if (!editor || disabled || imageBusy) return;
    const ctx = ctxRef.current;
    try {
      setImageBusy(true);
      const saved = await pickAndSaveImage({
        subject: ctx.subject,
        chapter: ctx.chapter,
        sectionId: ctx.sectionId,
      });
      if (!saved) return;
      editor
        .chain()
        .focus()
        .setImage({ src: saved.displaySrc, alt: "" })
        .run();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Не удалось вставить картинку";
      errRef.current?.(msg);
    } finally {
      setImageBusy(false);
    }
  }

  if (!editor) return null;

  const inTable = editor.isActive("table");
  const docAlign = currentDocAlign(editor);
  const toolsDisabled = disabled || imageBusy;

  return (
    <div className={`rich-editor${disabled ? " is-disabled" : ""}`}>
      <div className="edit-toolbar" role="toolbar" aria-label="Форматирование">
        <ToolBtn
          label="Ж"
          title="Жирный"
          active={editor.isActive("bold")}
          disabled={toolsDisabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolBtn
          label="К"
          title="Курсив"
          active={editor.isActive("italic")}
          disabled={toolsDisabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolSep />
        <ToolBtn
          label="Абз"
          title="Обычный абзац"
          active={editor.isActive("paragraph")}
          disabled={toolsDisabled}
          onClick={() => editor.chain().focus().setParagraph().run()}
        />
        <ToolBtn
          label="З1"
          title="Заголовок 1"
          active={editor.isActive("heading", { level: 1 })}
          disabled={toolsDisabled}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        />
        <ToolBtn
          label="З2"
          title="Заголовок 2"
          active={editor.isActive("heading", { level: 2 })}
          disabled={toolsDisabled}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        />
        <ToolBtn
          label="З3"
          title="Заголовок 3"
          active={editor.isActive("heading", { level: 3 })}
          disabled={toolsDisabled}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
        />
        <ToolSep />
        <ToolBtn
          label="По ширине"
          title="Выровнять текст по ширине (как в книге)"
          active={docAlign === "justify"}
          disabled={toolsDisabled}
          onClick={() => setDocumentAlign(editor, "justify")}
        />
        <ToolBtn
          label="По левому"
          title="По левому краю"
          active={docAlign === "left"}
          disabled={toolsDisabled}
          onClick={() => setDocumentAlign(editor, "left")}
        />
        <ToolBtn
          label="По центру"
          title="По центру"
          active={docAlign === "center"}
          disabled={toolsDisabled}
          onClick={() => setDocumentAlign(editor, "center")}
        />
        <ToolSep />
        <ToolBtn
          label="• Список"
          title="Маркированный список"
          active={editor.isActive("bulletList")}
          disabled={toolsDisabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolSep />
        <ToolBtn
          label="Таблица"
          title="Вставить таблицу 3×3"
          disabled={toolsDisabled}
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
              disabled={toolsDisabled}
              onClick={() => editor.chain().focus().addRowAfter().run()}
            />
            <ToolBtn
              label="−ряд"
              title="Удалить строку"
              disabled={toolsDisabled}
              onClick={() => editor.chain().focus().deleteRow().run()}
            />
            <ToolBtn
              label="+стлб"
              title="Добавить столбец"
              disabled={toolsDisabled}
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            />
            <ToolBtn
              label="−стлб"
              title="Удалить столбец"
              disabled={toolsDisabled}
              onClick={() => editor.chain().focus().deleteColumn().run()}
            />
            <ToolBtn
              label="×табл"
              title="Удалить таблицу"
              disabled={toolsDisabled}
              onClick={() => editor.chain().focus().deleteTable().run()}
            />
          </>
        )}
        <ToolSep />
        <ToolBtn
          label={imageBusy ? "…" : "Картинка"}
          title="Вставить картинку из файла (сохранится рядом с разделом). Также можно вставить из буфера: Cmd/Ctrl+V"
          disabled={toolsDisabled}
          onClick={() => void insertImageFromFile()}
        />
      </div>
      <div className="text-column">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
