import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { parseExportBlocks, type ExportBlock, type InlineRun } from "./model";
import { docxImageType, resolveExportImage } from "./imageEmbed";

function paragraphFromRuns(runs: InlineRun[], spacingAfter = 160): Paragraph {
  return new Paragraph({
    spacing: { after: spacingAfter, line: 276 },
    children: runs.length
      ? runs.map(
          (run) =>
            new TextRun({
              text: run.text,
              bold: run.bold,
              italics: run.italic,
              size: 22,
              font: "Calibri",
            }),
        )
      : [new TextRun({ text: "" })],
  });
}

function headingFromRuns(level: 1 | 2 | 3, runs: InlineRun[]): Paragraph {
  const map = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
  } as const;
  const sizes = { 1: 32, 2: 28, 3: 24 } as const;
  return new Paragraph({
    heading: map[level],
    spacing: { before: 240, after: 120 },
    children: runs.map(
      (run) =>
        new TextRun({
          text: run.text,
          bold: true,
          italics: run.italic,
          size: sizes[level],
          font: "Calibri",
        }),
    ),
  });
}

function cell(runs: InlineRun[], header = false): TableCell {
  return new TableCell({
    width: { size: 2500, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "C5D0C8" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "C5D0C8" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "C5D0C8" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "C5D0C8" },
    },
    shading: header ? { fill: "E3F0EC" } : undefined,
    children: [
      new Paragraph({
        children: runs.map(
          (run) =>
            new TextRun({
              text: run.text || " ",
              bold: header || run.bold,
              italics: run.italic,
              size: 20,
              font: "Calibri",
            }),
        ),
      }),
    ],
  });
}

function tableBlock(block: Extract<ExportBlock, { kind: "table" }>): Table {
  const colCount = Math.max(
    block.headers.length,
    ...block.rows.map((r) => r.length),
    1,
  );
  const pad = (cells: InlineRun[][]) => {
    const copy = [...cells];
    while (copy.length < colCount) copy.push([{ text: "" }]);
    return copy.slice(0, colCount);
  };

  return new Table({
    width: { size: 9000, type: WidthType.DXA },
    rows: [
      new TableRow({
        children: pad(block.headers).map((c) => cell(c, true)),
        tableHeader: true,
      }),
      ...block.rows.map(
        (row) =>
          new TableRow({
            children: pad(row).map((c) => cell(c, false)),
          }),
      ),
    ],
  });
}

async function blocksToChildren(
  blocks: ExportBlock[],
  chapterPath: string | null,
): Promise<(Paragraph | Table)[]> {
  const out: (Paragraph | Table)[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      out.push(headingFromRuns(block.level, block.runs));
      continue;
    }
    if (block.kind === "paragraph") {
      out.push(paragraphFromRuns(block.runs));
      continue;
    }
    if (block.kind === "list") {
      block.items.forEach((item, i) => {
        const prefix = block.ordered ? `${i + 1}. ` : "• ";
        out.push(paragraphFromRuns([{ text: prefix }, ...item], 80));
      });
      continue;
    }
    if (block.kind === "table") {
      out.push(tableBlock(block));
      out.push(new Paragraph({ children: [] }));
      continue;
    }
    if (block.kind === "image") {
      const img = await resolveExportImage(
        block.src,
        block.alt,
        chapterPath,
      );
      if (!img) {
        out.push(
          paragraphFromRuns([
            {
              text: block.alt
                ? `[картинка не найдена: ${block.alt}]`
                : "[картинка не найдена]",
              italic: true,
            },
          ]),
        );
        continue;
      }
      out.push(
        new Paragraph({
          spacing: { before: 120, after: 160 },
          children: [
            new ImageRun({
              type: docxImageType(img.mime),
              data: img.bytes,
              transformation: {
                width: img.widthPx,
                height: img.heightPx,
              },
              altText: {
                title: img.alt,
                description: img.alt,
                name: img.alt,
              },
            }),
          ],
        }),
      );
    }
  }
  return out;
}

export async function buildDocxBytes(
  markdown: string,
  meta: { subject: string; chapter: string; chapterPath?: string | null },
): Promise<Uint8Array> {
  const blocks = parseExportBlocks(markdown);
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: meta.subject,
          size: 18,
          color: "1F6F6A",
          font: "Calibri",
          bold: true,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 280 },
      children: [
        new TextRun({
          text: meta.chapter,
          size: 36,
          bold: true,
          font: "Calibri",
        }),
      ],
    }),
    ...(await blocksToChildren(blocks, meta.chapterPath ?? null)),
  ];

  if (blocks.length === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "Пустой конспект",
            italics: true,
            color: "666666",
          }),
        ],
      }),
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,
              bottom: 720,
              left: 900,
              right: 900,
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
