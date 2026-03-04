import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../types/authenticated-request.type";

const TENANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ): void {
    if (req.path.startsWith("/share-links/public/")) {
      next();
      return;
    }

    const rawTenantId = req.headers["x-tenant-id"];
    const tenantId =
      typeof rawTenantId === "string" ? rawTenantId.trim() : undefined;

    if (!tenantId) {
      res.status(400).json({
        message: "x-tenant-id header is required",
      });
      return;
    }

    if (!TENANT_ID_PATTERN.test(tenantId)) {
      res.status(400).json({
        message: "x-tenant-id must be a valid UUID",
      });
      return;
    }

    req.tenantId = tenantId;
    next();
  }
}
