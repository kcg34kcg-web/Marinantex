import { Injectable } from "@nestjs/common";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type IParagraphOptions,
} from "docx";

interface MarkNode {
  type?: string;
}

interface ContentNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: MarkNode[];
  content?: ContentNode[];
}

@Injectable()
export class DocxRendererService {
  async renderCanonicalToDocxBuffer(
    title: string,
    root: Record<string, unknown>,
  ): Promise<Buffer> {
    const contentCandidate = root.content;
    const docNode =
      contentCandidate && typeof contentCandidate === "object"
        ? (contentCandidate as ContentNode)
        : ({ type: "doc", content: [] } as ContentNode);

    const children = Array.isArray(docNode.content) ? docNode.content : [];
    const paragraphs: Paragraph[] = [];

    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun({ text: title, bold: true })],
        spacing: { after: 280 },
      }),
    );

    for (const node of children) {
      paragraphs.push(...this.renderBlock(node));
    }

    if (paragraphs.length === 1) {
      paragraphs.push(new Paragraph({ text: "" }));
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs,
        },
      ],
    });

    return Packer.toBuffer(doc);
  }

  private renderBlock(node: ContentNode): Paragraph[] {
    const type = node.type ?? "paragraph";

    if (type === "heading") {
      const levelRaw = node.attrs?.level;
      const headingLevel =
        levelRaw === 1
          ? HeadingLevel.HEADING_1
          : levelRaw === 2
            ? HeadingLevel.HEADING_2
            : levelRaw === 3
              ? HeadingLevel.HEADING_3
              : HeadingLevel.HEADING_4;
      return [this.createParagraph(node, { heading: headingLevel })];
    }

    if (type === "paragraph") {
      return [this.createParagraph(node)];
    }

    if (type === "blockquote") {
      return [
        this.createParagraph(node, {
          indent: { left: 720 },
        }),
      ];
    }

    if (type === "bulletList" || type === "orderedList") {
      const items = Array.isArray(node.content) ? node.content : [];
      return items.flatMap((item) => {
        const itemBlocks = Array.isArray(item.content) ? item.content : [];
        if (itemBlocks.length === 0) {
          return [new Paragraph({ text: "- " })];
        }
        return itemBlocks.map((inner) =>
          this.createParagraph(inner, {
            bullet: {
              level: 0,
            },
          }),
        );
      });
    }

    if (type === "doc") {
      const nested = Array.isArray(node.content) ? node.content : [];
      return nested.flatMap((child) => this.renderBlock(child));
    }

    return [this.createParagraph(node)];
  }

  private createParagraph(
    node: ContentNode,
    extra?: Partial<IParagraphOptions>,
  ): Paragraph {
    const runs = this.extractRuns(node);
    const align = this.mapAlignment(node.attrs?.textAlign);

    return new Paragraph({
      children: runs.length > 0 ? runs : [new TextRun("")],
      alignment: align,
      spacing: { after: 200 },
      ...extra,
    });
  }

  private extractRuns(node: ContentNode): TextRun[] {
    const children = Array.isArray(node.content) ? node.content : [];
    const runs: TextRun[] = [];

    for (const child of children) {
      if (child.type === "text") {
        const text = child.text ?? "";
        runs.push(
          new TextRun({
            text,
            bold: this.hasMark(child.marks, "bold"),
            italics: this.hasMark(child.marks, "italic"),
            underline: this.hasMark(child.marks, "underline") ? {} : undefined,
            strike: this.hasMark(child.marks, "strike"),
          }),
        );
      } else if (child.type === "hardBreak") {
        runs.push(new TextRun({ break: 1 }));
      } else if (child.type === "dynamicField") {
        const labelRaw = child.attrs?.label;
        const keyRaw = child.attrs?.fieldKey;
        const valueRaw = child.attrs?.value;
        const label =
          typeof labelRaw === "string"
            ? labelRaw
            : typeof keyRaw === "string"
              ? keyRaw
              : "Alan";
        const value = typeof valueRaw === "string" && valueRaw.length > 0 ? valueRaw : `{{${label}}}`;
        runs.push(
          new TextRun({
            text: value,
            underline: {},
            italics: true,
          }),
        );
      } else if (Array.isArray(child.content)) {
        runs.push(...this.extractRuns(child));
      }
    }

    return runs;
  }

  private hasMark(marks: MarkNode[] | undefined, type: string): boolean {
    return Boolean(marks?.some((mark) => mark.type === type));
  }

  private mapAlignment(
    alignRaw: unknown,
  ): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
    if (alignRaw === "left") {
      return AlignmentType.LEFT;
    }
    if (alignRaw === "right") {
      return AlignmentType.RIGHT;
    }
    if (alignRaw === "center") {
      return AlignmentType.CENTER;
    }
    if (alignRaw === "justify") {
      return AlignmentType.JUSTIFIED;
    }
    return undefined;
  }
}
