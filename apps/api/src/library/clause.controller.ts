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
import { ClauseService } from "./clause.service";
import { CreateClauseDto } from "./dto/create-clause.dto";
import { ListClauseQueryDto } from "./dto/list-clause-query.dto";
import { UpdateClauseDto } from "./dto/update-clause.dto";

@Controller("clauses")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClauseController {
  constructor(private readonly clauseService: ClauseService) {}

  @Get()
  @Roles("OWNER", "ADMIN", "EDITOR", "REVIEWER", "COMMENTER", "VIEWER")
  async list(@Req() req: AuthenticatedRequest, @Query() query: ListClauseQueryDto) {
    return this.clauseService.list(req.tenantId!, query);
  }

  @Post()
  @Roles("OWNER", "ADMIN", "EDITOR")
  async create(@Req() req: AuthenticatedRequest, @Body() body: CreateClauseDto) {
    return this.clauseService.create(req.tenantId!, req.user!.sub, body);
  }

  @Patch(":id")
  @Roles("OWNER", "ADMIN", "EDITOR")
  async update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: UpdateClauseDto,
  ) {
    return this.clauseService.update(req.tenantId!, req.user!.sub, id, body);
  }
}
