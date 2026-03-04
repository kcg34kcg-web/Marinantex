import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { CreateShareLinkCommentDto } from "./dto/create-share-link-comment.dto";
import { ShareLinksService } from "./share-links.service";

@Controller("share-links/public")
export class PublicShareLinksController {
  constructor(private readonly shareLinksService: ShareLinksService) {}

  @Get(":token")
  async resolve(@Req() req: Request, @Param("token") token: string) {
    return this.shareLinksService.resolvePublic(token, {
      requestId: this.header(req, "x-request-id"),
      ipAddress: req.ip,
      userAgent: this.header(req, "user-agent"),
    });
  }

  @Post(":token/comments")
  async createComment(
    @Req() req: Request,
    @Param("token") token: string,
    @Body() body: CreateShareLinkCommentDto,
  ) {
    return this.shareLinksService.createPublicComment(token, body, {
      requestId: this.header(req, "x-request-id"),
      ipAddress: req.ip,
      userAgent: this.header(req, "user-agent"),
    });
  }

  private header(req: Request, key: string): string | undefined {
    const value = req.headers[key];
    return typeof value === "string" ? value : undefined;
  }
}
