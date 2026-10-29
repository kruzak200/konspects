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
import {
  parseExportBlocks,
  type CellAlign,
  type ExportBlock,
  type ExportTableCell,
  type InlineRun,
} from "./model";
import { docxImageType, resolveExportImage } from "./imageEmbed";

function alignType(align: CellAlign) {
  if (align === "center") return AlignmentType.CENTER;
  if (align === "right") return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

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

function cell(
  data: ExportTableCell,
  header = false,
  widthDxa = 2500,
): TableCell {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    columnSpan: data.colspan > 1 ? data.colspan : undefined,
    rowSpan: data.rowspan > 1 ? data.rowspan : undefined,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "C5D0C8" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "C5D0C8" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "C5D0C8" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "C5D0C8" },
    },
    shading: header ? { fill: "E3F0EC" } : undefined,
    children: [
      new Paragraph({
        alignment: alignType(data.align),
        children: data.runs.length
          ? data.runs.map(
              (run) =>
                new TextRun({
                  text: run.text || " ",
                  bold: header || run.bold,
                  italics: run.italic,
                  size: 20,
                  font: "Calibri",
                }),
            )
          : [new TextRun({ text: " " })],
      }),
    ],
  });
}

function tableBlock(block: Extract<ExportBlock, { kind: "table" }>): Table {
  const gridCols = Math.max(
    block.headers.reduce((n, c) => n + c.colspan, 0),
    ...block.rows.map((r) => r.reduce((n, c) => n + c.colspan, 0)),
    1,
  );
  const totalWidth = 9000;
  const shares =
    block.colShares && block.colShares.length === gridCols
      ? block.colShares
      : Array.from({ length: gridCols }, () => 1);
  const shareSum = shares.reduce((a, b) => a + b, 0) || gridCols;
  const colWidths = shares.map((s) =>
    Math.max(400, Math.round((s / shareSum) * totalWidth)),
  );

  const widthFor = (startCol: number, span: number) =>
    colWidths.slice(startCol, startCol + span).reduce((a, b) => a + b, 0) ||
    Math.round(totalWidth / gridCols);

  const mapRow = (cells: ExportTableCell[], header: boolean) => {
    let col = 0;
    return cells.map((c) => {
      const w = widthFor(col, c.colspan);
      col += c.colspan;
      return cell(c, header, w);
    });
  };

  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({
        children: mapRow(block.headers, true),
        tableHeader: true,
      }),
      ...block.rows.map(
        (row) =>
          new TableRow({
            children: mapRow(row, false),
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
