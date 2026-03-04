import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { DocumentsModule } from "./documents/documents.module";
import { ExportsModule } from "./exports/exports.module";
import { LibraryModule } from "./library/library.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ShareLinksModule } from "./share-links/share-links.module";
import { TenantMiddleware } from "./security/middleware/tenant.middleware";
import { SecurityModule } from "./security/security.module";

const rateLimitTtlMs = Number.parseInt(process.env.RATE_LIMIT_TTL_MS ?? "60000", 10);
const rateLimitLimit = Number.parseInt(process.env.RATE_LIMIT_LIMIT ?? "120", 10);

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: Number.isInteger(rateLimitTtlMs) && rateLimitTtlMs > 0 ? rateLimitTtlMs : 60000,
        limit: Number.isInteger(rateLimitLimit) && rateLimitLimit > 0 ? rateLimitLimit : 120,
      },
    ]),
    PrismaModule,
    AuditModule,
    AuthModule,
    SecurityModule,
    DocumentsModule,
    ExportsModule,
    LibraryModule,
    ShareLinksModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantMiddleware)
      .exclude(
        { path: "health", method: RequestMethod.GET },
        { path: "", method: RequestMethod.GET },
        { path: "auth/login", method: RequestMethod.POST },
      )
      .forRoutes({ path: "*", method: RequestMethod.ALL });
  }
}
