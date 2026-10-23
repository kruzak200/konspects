import { useMemo } from "react";
import { markdownToHtml } from "./markdownCodec";

export function ConspectBlocks({ content }: { content: string }) {
  const trimmed = content.trim();
  const html = useMemo(
    () => (trimmed ? markdownToHtml(trimmed) : ""),
    [trimmed],
  );

  if (!trimmed) {
    return (
      <p className="reader-empty">
        Пока пусто. Вставьте готовый конспект из Merlin во вкладке «Править».
      </p>
    );
  }

  return (
    <div
      className="reader-blocks conspect-prose"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
