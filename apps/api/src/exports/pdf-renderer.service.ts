import { Injectable } from "@nestjs/common";
import { chromium } from "playwright";

@Injectable()
export class PdfRendererService {
  async renderHtmlToPdfBuffer(html: string): Promise<Buffer> {
    const browser = await chromium.launch({
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: "domcontentloaded",
      });
      const payload = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
          top: "0mm",
          right: "0mm",
          bottom: "0mm",
          left: "0mm",
        },
      });
      return payload;
    } finally {
      await browser.close();
    }
  }
}
