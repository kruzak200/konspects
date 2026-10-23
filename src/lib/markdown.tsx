import type { ReactNode } from "react";

type Block =
  | { kind: "h1" | "h2" | "h3"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "p"; text: string };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3;
      blocks.push({
        kind: (`h${level}` as "h1" | "h2" | "h3"),
        text: heading[2].trim(),
      });
      i += 1;
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const current = lines[i];
        if (!current.trim()) break;
        const bullet = /^\s*[-*•]\s+(.+)$/.exec(current);
        const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(current);
        if (bullet) {
          items.push(bullet[1].trim());
          i += 1;
          continue;
        }
        if (numbered) {
          items.push(numbered[1].trim());
          i += 1;
          continue;
        }
        break;
      }
      if (items.length) {
        blocks.push({ kind: "list", items });
        continue;
      }
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim()) {
      if (/^#{1,3}\s+/.test(lines[i])) break;
      if (/^\s*[-*•]\s+/.test(lines[i]) || /^\s*\d+[.)]\s+/.test(lines[i])) {
        break;
      }
      para.push(lines[i].trim());
      i += 1;
    }
    if (para.length) {
      blocks.push({ kind: "p", text: para.join(" ") });
    }
  }

  return blocks;
}

export function ConspectBlocks({ content }: { content: string }) {
  const trimmed = content.trim();
  if (!trimmed) {
    return (
      <p className="reader-empty">
        Пока пусто. Вставьте готовый конспект из Merlin во вкладке «Вставить».
      </p>
    );
  }

  const blocks = parseBlocks(trimmed);
  const nodes: ReactNode[] = blocks.map((block, index) => {
    if (block.kind === "h1") {
      return (
        <h1 key={index} className="reader-h1">
          {block.text}
        </h1>
      );
    }
    if (block.kind === "h2") {
      return (
        <h2 key={index} className="reader-h2">
          {block.text}
        </h2>
      );
    }
    if (block.kind === "h3") {
      return (
        <h3 key={index} className="reader-h3">
          {block.text}
        </h3>
      );
    }
    if (block.kind === "list") {
      return (
        <ul key={index} className="reader-list">
          {block.items.map((item, j) => (
            <li key={j}>{item}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={index} className="reader-p">
        {block.text}
      </p>
    );
  });

  return <div className="reader-blocks">{nodes}</div>;
}
