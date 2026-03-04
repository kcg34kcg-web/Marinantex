import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { DocumentsService } from "./documents.service";
import { Roles } from "../security/decorators/roles.decorator";
import { JwtAuthGuard } from "../security/guards/jwt-auth.guard";
import { RolesGuard } from "../security/guards/roles.guard";
import { DocumentAccess } from "../security/decorators/document-access.decorator";
import { DocumentAccessGuard } from "../security/guards/document-access.guard";
import type { AuthenticatedRequest } from "../security/types/authenticated-request.type";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { ListDocumentsQueryDto } from "./dto/list-documents-query.dto";
import { UpdateDocumentTitleDto } from "./dto/update-document-title.dto";
import { UpdateDocumentContentDto } from "./dto/update-document-content.dto";
import { ChangeDocumentStatusDto } from "./dto/change-document-status.dto";
import { CreateSnapshotDto } from "./dto/create-snapshot.dto";
import { LockLeaseDto } from "./dto/lock-lease.dto";
import { DocumentLockService } from "./document-lock.service";
import { AutosaveDocumentDto } from "./dto/autosave-document.dto";

@Controller("documents")
@UseGuards(JwtAuthGuard, RolesGuard, DocumentAccessGuard)
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly lockService: DocumentLockService,
  ) {}

  @Get()
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  async listDocuments(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListDocumentsQueryDto,
  ) {
    return this.documentsService.list(req.tenantId!, query);
  }

  @Post()
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER")
  async createDocument(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateDocumentDto,
  ) {
    return this.documentsService.create(req.tenantId!, req.user!.sub, body, {
      requestId: this.header(req, "x-request-id"),
      ipAddress: req.ip,
      userAgent: this.header(req, "user-agent"),
    });
  }

  @Get(":id")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  @DocumentAccess("view")
  async getDocument(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.documentsService.getById(id, req.tenantId!);
  }

  @Get(":id/versions")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  @DocumentAccess("view")
  async listVersions(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.documentsService.listVersions(id, req.tenantId!);
  }

  @Get(":id/locks/current")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  @DocumentAccess("view")
  async getCurrentLock(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.lockService.getCurrent(req.tenantId!, id);
  }

  @Post(":id/locks/acquire")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER")
  @DocumentAccess("edit")
  async acquireLock(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: LockLeaseDto,
  ) {
    return this.lockService.acquire(
      req.tenantId!,
      id,
      req.user!.sub,
      body.leaseSeconds ?? 120,
    );
  }

  @Post(":id/locks/refresh")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER")
  @DocumentAccess("edit")
  async refreshLock(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: LockLeaseDto,
  ) {
    return this.lockService.refresh(
      req.tenantId!,
      id,
      req.user!.sub,
      body.leaseSeconds ?? 120,
    );
  }

  @Post(":id/locks/release")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER")
  @DocumentAccess("edit")
  async releaseLock(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.lockService.release(req.tenantId!, id, req.user!.sub);
  }

  @Patch(":id/title")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER")
  @DocumentAccess("edit")
  async updateTitle(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: UpdateDocumentTitleDto,
  ) {
    return this.documentsService.updateTitle(
      id,
      req.tenantId!,
      req.user!.sub,
      body.title,
      {
        requestId: this.header(req, "x-request-id"),
        ipAddress: req.ip,
        userAgent: this.header(req, "user-agent"),
      },
    );
  }

  @Patch(":id/content")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER")
  @DocumentAccess("edit")
  async updateContent(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: UpdateDocumentContentDto,
  ) {
    return this.documentsService.updateContent(
      id,
      req.tenantId!,
      req.user!.sub,
      body,
    );
  }

  @Post(":id/autosave")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER")
  @DocumentAccess("edit")
  async autosave(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: AutosaveDocumentDto,
  ) {
    return this.documentsService.autosave(
      id,
      req.tenantId!,
      req.user!.sub,
      body,
      {
        requestId: this.header(req, "x-request-id"),
        ipAddress: req.ip,
        userAgent: this.header(req, "user-agent"),
      },
    );
  }

  @Patch(":id/status")
  @Roles("OWNER", "ADMIN", "EDITOR")
  @DocumentAccess("status")
  async changeStatus(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: ChangeDocumentStatusDto,
  ) {
    return this.documentsService.changeStatus(
      id,
      req.tenantId!,
      req.user!.sub,
      body,
      {
        requestId: this.header(req, "x-request-id"),
        ipAddress: req.ip,
        userAgent: this.header(req, "user-agent"),
      },
    );
  }

  @Post(":id/snapshots")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER")
  @DocumentAccess("edit")
  async createSnapshot(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: CreateSnapshotDto,
  ) {
    return this.documentsService.createSnapshot(
      id,
      req.tenantId!,
      req.user!.sub,
      body,
    );
  }

  @Post(":id/finalize")
  @Roles("OWNER", "ADMIN", "EDITOR")
  @DocumentAccess("finalize")
  async finalize(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.documentsService.finalize(id, req.tenantId!, req.user!.sub, {
      requestId: this.header(req, "x-request-id"),
      ipAddress: req.ip,
      userAgent: this.header(req, "user-agent"),
    });
  }

  @Post(":id/fork-draft")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER")
  @DocumentAccess("view")
  async forkDraftFromFinal(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    return this.documentsService.forkDraftFromFinal(
      id,
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
