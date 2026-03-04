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
import { Roles } from "../security/decorators/roles.decorator";
import { JwtAuthGuard } from "../security/guards/jwt-auth.guard";
import { RolesGuard } from "../security/guards/roles.guard";
import type { AuthenticatedRequest } from "../security/types/authenticated-request.type";
import { CreateTemplateDto } from "./dto/create-template.dto";
import { ListTemplateQueryDto } from "./dto/list-template-query.dto";
import { UpdateTemplateDto } from "./dto/update-template.dto";
import { TemplateService } from "./template.service";

@Controller("templates")
@UseGuards(JwtAuthGuard, RolesGuard)
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @Get()
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  async list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListTemplateQueryDto,
  ) {
    return this.templateService.list(req.tenantId!, query);
  }

  @Get(":id")
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  async getById(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.templateService.getById(req.tenantId!, id);
  }

  @Post()
  @Roles("OWNER", "ADMIN", "EDITOR")
  async create(@Req() req: AuthenticatedRequest, @Body() body: CreateTemplateDto) {
    return this.templateService.create(req.tenantId!, req.user!.sub, body);
  }

  @Patch(":id")
  @Roles("OWNER", "ADMIN", "EDITOR")
  async update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: UpdateTemplateDto,
  ) {
    return this.templateService.update(req.tenantId!, req.user!.sub, id, body);
  }
}
