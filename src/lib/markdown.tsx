import { useMemo } from "react";
import { markdownToHtml, sanitizeChapterMarkdown } from "./markdownCodec";
import { resolveMarkdownImages } from "./images";

export function ConspectBlocks({
  content,
  chapterPath,
}: {
  content: string;
  chapterPath?: string | null;
}) {
  const trimmed = content.trim();
  const html = useMemo(() => {
    if (!trimmed) return "";
    const resolved = resolveMarkdownImages(
      sanitizeChapterMarkdown(trimmed),
      chapterPath ?? null,
    );
    return markdownToHtml(resolved);
  }, [trimmed, chapterPath]);

  if (!trimmed) {
    return (
      <p className="reader-empty">
        Пока пусто. Вставьте готовый конспект из Merlin во вкладке «Править».
      </p>
    );
  }

  return (
    <div className="text-column">
      <div
        className="reader-blocks conspect-prose"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
