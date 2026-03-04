import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Roles } from "../security/decorators/roles.decorator";
import { DocumentAccess } from "../security/decorators/document-access.decorator";
import { JwtAuthGuard } from "../security/guards/jwt-auth.guard";
import { RolesGuard } from "../security/guards/roles.guard";
import { DocumentAccessGuard } from "../security/guards/document-access.guard";
import type { AuthenticatedRequest } from "../security/types/authenticated-request.type";
import { DocumentExportService } from "./document-export.service";

@Controller("documents")
@UseGuards(JwtAuthGuard, RolesGuard, DocumentAccessGuard)
export class DocumentExportController {
  constructor(private readonly documentExportService: DocumentExportService) {}

  @Get(":id/print-preview")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  @DocumentAccess("view")
  async getPrintPreview(
    @Req() req: AuthenticatedRequest,
    @Param("id") documentId: string,
  ) {
    return this.documentExportService.getPrintPreview(documentId, req.tenantId!);
  }

  @Post(":id/exports/pdf")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  @DocumentAccess("view")
  async requestPdfExport(
    @Req() req: AuthenticatedRequest,
    @Param("id") documentId: string,
  ) {
    return this.documentExportService.requestPdfExport(
      documentId,
      req.tenantId!,
      req.user!.sub,
      {
        requestId: this.header(req, "x-request-id"),
        ipAddress: req.ip,
        userAgent: this.header(req, "user-agent"),
      },
    );
  }

  @Post(":id/exports/docx")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  @DocumentAccess("view")
  async requestDocxExport(
    @Req() req: AuthenticatedRequest,
    @Param("id") documentId: string,
  ) {
    return this.documentExportService.requestDocxExport(
      documentId,
      req.tenantId!,
      req.user!.sub,
      {
        requestId: this.header(req, "x-request-id"),
        ipAddress: req.ip,
        userAgent: this.header(req, "user-agent"),
      },
    );
  }

  @Get(":id/exports")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  @DocumentAccess("view")
  async listExports(
    @Req() req: AuthenticatedRequest,
    @Param("id") documentId: string,
  ) {
    return this.documentExportService.listExports(documentId, req.tenantId!);
  }

  @Get(":id/exports/:exportId/signed-url")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  @DocumentAccess("view")
  async issueSignedUrl(
    @Req() req: AuthenticatedRequest,
    @Param("id") documentId: string,
    @Param("exportId") exportId: string,
  ) {
    return this.documentExportService.issueSignedDownloadUrl(
      documentId,
      exportId,
      req.tenantId!,
      req.user!.sub,
      {
        requestId: this.header(req, "x-request-id"),
        ipAddress: req.ip,
        userAgent: this.header(req, "user-agent"),
      },
    );
  }

  @Post(":id/exports/:exportId/downloaded")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  @DocumentAccess("view")
  async markDownloaded(
    @Req() req: AuthenticatedRequest,
    @Param("id") documentId: string,
    @Param("exportId") exportId: string,
  ) {
    return this.documentExportService.markDownloaded(
      documentId,
      exportId,
      req.tenantId!,
      req.user!.sub,
      {
        requestId: this.header(req, "x-request-id"),
        ipAddress: req.ip,
        userAgent: this.header(req, "user-agent"),
      },
    );
  }

  private header(req: AuthenticatedRequest, key: string): string | undefined {
    const value = req.headers[key];
    return typeof value === "string" ? value : undefined;
  }
}
