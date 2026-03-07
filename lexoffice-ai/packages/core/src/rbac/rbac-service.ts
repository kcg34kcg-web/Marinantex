import type { PrismaClient } from "@lexoffice/db";
import { ForbiddenError } from "../errors/app-error";
import { PERMISSIONS, type PermissionCode } from "./permission-codes";

export class RBACService {
  constructor(private readonly prisma: PrismaClient) {}

  async getUserPermissions(userId: string, tenantId: string): Promise<Set<string>> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        tenantId,
        status: "ACTIVE",
        deletedAt: null
      },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true
              }
            }
          }
        }
      }
    });

    if (!membership) {
      return new Set<string>();
    }

    const permissions = membership.role.permissions.map((entry: { permission: { code: string } }) => entry.permission.code);
    return new Set(permissions);
  }

  async hasPermission(userId: string, tenantId: string, permission: PermissionCode): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId, tenantId);

    if (permissions.has(PERMISSIONS.ADMIN_ALL)) {
      return true;
    }

    return permissions.has(permission);
  }

  async requirePermission(userId: string, tenantId: string, permission: PermissionCode): Promise<void> {
    const allowed = await this.hasPermission(userId, tenantId, permission);
    if (!allowed) {
      throw new ForbiddenError(`İşlem için gerekli yetki: ${permission}`);
    }
  }
}
