import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DocumentAccessGuard } from "./guards/document-access.guard";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";

@Module({
  imports: [AuthModule],
  providers: [JwtAuthGuard, RolesGuard, DocumentAccessGuard],
  exports: [JwtAuthGuard, RolesGuard, DocumentAccessGuard],
})
export class SecurityModule {}
