import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@lexoffice/db";
import { PERMISSIONS } from "./permission-codes";
import { RBACService } from "./rbac-service";

describe("RBACService", () => {
  it("admin.all yetkisi varsa hedef yetkiyi true döner", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      role: {
        permissions: [
          { permission: { code: PERMISSIONS.ADMIN_ALL } },
          { permission: { code: PERMISSIONS.MAIL_SEND } }
        ]
      }
    });

    const prisma = {
      membership: {
        findFirst
      }
    } as unknown as PrismaClient;

    const service = new RBACService(prisma);

    const result = await service.hasPermission("user-1", "tenant-1", PERMISSIONS.DOMAIN_MANAGE);
    expect(result).toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("membership yoksa yetkiyi false döner", async () => {
    const prisma = {
      membership: {
        findFirst: vi.fn().mockResolvedValue(null)
      }
    } as unknown as PrismaClient;

    const service = new RBACService(prisma);
    const result = await service.hasPermission("user-1", "tenant-1", PERMISSIONS.MAIL_SEND);
    expect(result).toBe(false);
  });
});
