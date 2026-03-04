declare module 'pdf-parse' {
  type PdfParseResult = {
    text?: string;
    numpages?: number;
    numrender?: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
    version?: string;
  };

  type PdfParseFn = (dataBuffer: Buffer) => Promise<PdfParseResult>;

  const pdfParse: PdfParseFn;
  export default pdfParse;
}
