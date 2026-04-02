import { Injectable } from "@nestjs/common";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
  type IParagraphOptions,
  type ParagraphChild,
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

interface PageMeta {
  headerText: string;
  footerText: string;
  showPageNumbers: boolean;
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
    const footnotes: string[] = [];
    const pageMeta = this.extractPageMeta(docNode);

    paragraphs.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun({ text: title, bold: true })],
        spacing: { after: 280 },
      }),
    );

    for (const node of children) {
      paragraphs.push(...this.renderBlock(node, footnotes));
    }

    if (footnotes.length > 0) {
      paragraphs.push(
        new Paragraph({
          text: "",
          spacing: { after: 120 },
        }),
      );
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: [new TextRun({ text: "Dipnotlar", bold: true })],
          spacing: { after: 200 },
        }),
      );
      footnotes.forEach((item, index) => {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: `[${index + 1}] ${item}` })],
            spacing: { after: 120 },
          }),
        );
      });
    }

    if (paragraphs.length === 1) {
      paragraphs.push(new Paragraph({ text: "" }));
    }

    const section: {
      properties: Record<string, unknown>;
      children: Paragraph[];
      headers?: { default: Header };
      footers?: { default: Footer };
    } = {
      properties: {},
      children: paragraphs,
    };

    if (pageMeta?.headerText) {
      section.headers = {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: pageMeta.headerText, size: 20 })],
            }),
          ],
        }),
      };
    }

    if (pageMeta && (pageMeta.footerText || pageMeta.showPageNumbers)) {
      const footerChildren: ParagraphChild[] = [];
      if (pageMeta.footerText) {
        footerChildren.push(new TextRun({ text: pageMeta.footerText, size: 20 }));
      }
      if (pageMeta.showPageNumbers) {
        if (pageMeta.footerText) {
          footerChildren.push(new TextRun({ text: "   " }));
        }
        footerChildren.push(new TextRun({ text: "Sayfa ", size: 20 }));
        footerChildren.push(new TextRun({ children: [PageNumber.CURRENT], size: 20 }));
      }
      section.footers = {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: footerChildren.length ? footerChildren : [new TextRun("")],
            }),
          ],
        }),
      };
    }

    const doc = new Document({ sections: [section] });

    return Packer.toBuffer(doc);
  }

  private renderBlock(node: ContentNode, footnotes: string[]): Paragraph[] {
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
      return [this.createParagraph(node, { heading: headingLevel }, footnotes)];
    }

    if (type === "paragraph") {
      return [this.createParagraph(node, undefined, footnotes)];
    }

    if (type === "blockquote") {
      return [
        this.createParagraph(node, {
          indent: { left: 720 },
        }, footnotes),
      ];
    }

    if (type === "bulletList") {
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
          }, footnotes),
        );
      });
    }

    if (type === "orderedList") {
      const items = Array.isArray(node.content) ? node.content : [];
      const startRaw = node.attrs?.start;
      const start =
        typeof startRaw === "number" && Number.isFinite(startRaw) && startRaw > 0
          ? Math.floor(startRaw)
          : 1;
      const listStyleType = this.normalizeOrderedListStyle(node.attrs?.listStyleType);
      return items.flatMap((item, index) => {
        const itemBlocks = Array.isArray(item.content) ? item.content : [];
        const prefixText = `${this.formatOrderedListLabel(start + index, listStyleType)}. `;
        if (itemBlocks.length === 0) {
          return [
            new Paragraph({
              children: [new TextRun({ text: prefixText })],
            }),
          ];
        }
        return itemBlocks.map((inner, innerIndex) =>
          this.createParagraph(
            inner,
            innerIndex === 0 ? undefined : { indent: { left: 360 } },
            footnotes,
            innerIndex === 0 ? [new TextRun({ text: prefixText })] : undefined,
          ),
        );
      });
    }

    if (type === "doc") {
      const nested = Array.isArray(node.content) ? node.content : [];
      return nested.flatMap((child) => this.renderBlock(child, footnotes));
    }

    return [this.createParagraph(node, undefined, footnotes)];
  }

  private createParagraph(
    node: ContentNode,
    extra?: Partial<IParagraphOptions>,
    footnotes: string[] = [],
    prefixRuns?: TextRun[],
  ): Paragraph {
    const runs = this.extractRuns(node, footnotes);
    const align = this.mapAlignment(node.attrs?.textAlign);
    const children = [...(prefixRuns || []), ...(runs.length > 0 ? runs : [new TextRun("")])];

    return new Paragraph({
      children,
      alignment: align,
      spacing: { after: 200 },
      ...extra,
    });
  }

  private extractRuns(node: ContentNode, footnotes: string[]): TextRun[] {
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
      } else if (child.type === "footnote") {
        const rawContent = child.attrs?.content;
        const content =
          typeof rawContent === "string" && rawContent.trim().length > 0
            ? rawContent.trim()
            : "Dipnot";
        footnotes.push(content);
        const index = footnotes.length;
        runs.push(
          new TextRun({
            text: `[${index}]`,
            superScript: true,
          }),
        );
      } else if (Array.isArray(child.content)) {
        runs.push(...this.extractRuns(child, footnotes));
      }
    }

    return runs;
  }

  private hasMark(marks: MarkNode[] | undefined, type: string): boolean {
    return Boolean(marks?.some((mark) => mark.type === type));
  }

  private extractPageMeta(root: ContentNode): PageMeta | null {
    const rootRecord = root as unknown as Record<string, unknown>;
    const raw = rootRecord.pageMeta;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const candidate = raw as Record<string, unknown>;
    const headerText =
      typeof candidate.headerText === "string" ? candidate.headerText.trim() : "";
    const footerText =
      typeof candidate.footerText === "string" ? candidate.footerText.trim() : "";
    const showPageNumbers = candidate.showPageNumbers === true;
    if (!headerText && !footerText && !showPageNumbers) return null;
    return { headerText, footerText, showPageNumbers };
  }

  private normalizeOrderedListStyle(
    value: unknown,
  ): "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman" {
    if (
      value === "lower-alpha" ||
      value === "upper-alpha" ||
      value === "lower-roman" ||
      value === "upper-roman"
    ) {
      return value;
    }
    return "decimal";
  }

  private formatOrderedListLabel(
    value: number,
    style: "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman",
  ): string {
    if (style === "lower-alpha" || style === "upper-alpha") {
      const alpha = this.toAlphabeticLabel(value);
      return style === "upper-alpha" ? alpha.toUpperCase() : alpha.toLowerCase();
    }
    if (style === "lower-roman" || style === "upper-roman") {
      const roman = this.toRomanLabel(value);
      return style === "upper-roman" ? roman.toUpperCase() : roman.toLowerCase();
    }
    return String(value);
  }

  private toAlphabeticLabel(value: number): string {
    let index = Math.max(1, Math.floor(value));
    let result = "";
    while (index > 0) {
      const remainder = (index - 1) % 26;
      result = String.fromCharCode(97 + remainder) + result;
      index = Math.floor((index - 1) / 26);
    }
    return result || "a";
  }

  private toRomanLabel(value: number): string {
    let remaining = Math.max(1, Math.floor(value));
    const map: Array<[number, string]> = [
      [1000, "M"],
      [900, "CM"],
      [500, "D"],
      [400, "CD"],
      [100, "C"],
      [90, "XC"],
      [50, "L"],
      [40, "XL"],
      [10, "X"],
      [9, "IX"],
      [5, "V"],
      [4, "IV"],
      [1, "I"],
    ];
    let result = "";
    for (const [base, numeral] of map) {
      while (remaining >= base) {
        result += numeral;
        remaining -= base;
      }
    }
    return result || "I";
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
