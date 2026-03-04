import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { DocumentAccess } from "../security/decorators/document-access.decorator";
import { Roles } from "../security/decorators/roles.decorator";
import { DocumentAccessGuard } from "../security/guards/document-access.guard";
import { JwtAuthGuard } from "../security/guards/jwt-auth.guard";
import { RolesGuard } from "../security/guards/roles.guard";
import type { AuthenticatedRequest } from "../security/types/authenticated-request.type";
import { CreateShareLinkDto } from "./dto/create-share-link.dto";
import { ShareLinksService } from "./share-links.service";

@Controller("documents/:documentId/share-links")
@UseGuards(JwtAuthGuard, RolesGuard, DocumentAccessGuard)
export class DocumentShareLinksController {
  constructor(private readonly shareLinksService: ShareLinksService) {}

  @Get()
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  @DocumentAccess("view")
  async list(
    @Req() req: AuthenticatedRequest,
    @Param("documentId") documentId: string,
  ) {
    return this.shareLinksService.list(req.tenantId!, documentId);
  }

  @Post()
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER")
  @DocumentAccess("view")
  async create(
    @Req() req: AuthenticatedRequest,
    @Param("documentId") documentId: string,
    @Body() body: CreateShareLinkDto,
  ) {
    return this.shareLinksService.create(
      req.tenantId!,
      documentId,
      req.user!.sub,
      body,
      {
        requestId: this.header(req, "x-request-id"),
        ipAddress: req.ip,
        userAgent: this.header(req, "user-agent"),
      },
    );
  }

  @Post(":shareLinkId/revoke")
  @Roles("OWNER", "ADMIN", "EDITOR")
  @DocumentAccess("view")
  async revoke(
    @Req() req: AuthenticatedRequest,
    @Param("documentId") documentId: string,
    @Param("shareLinkId") shareLinkId: string,
  ) {
    return this.shareLinksService.revoke(
      req.tenantId!,
      documentId,
      shareLinkId,
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
