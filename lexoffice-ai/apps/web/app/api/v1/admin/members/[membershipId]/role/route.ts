import { z } from "zod";
import { ForbiddenError, NotFoundError, PERMISSIONS } from "@lexoffice/core";
import { prisma } from "@lexoffice/db";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";

const updateMemberRoleSchema = z.object({
  tenantId: z.string().cuid(),
  roleCode: z.string().min(2)
});

export async function POST(
  request: Request,
  context: {
    params: Promise<{ membershipId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const { membershipId } = await context.params;
    const payload = updateMemberRoleSchema.parse(await request.json());

    if (session.tenantId !== payload.tenantId) {
      throw new ForbiddenError("Tenant uyuşmazlığı");
    }

    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.ADMIN_ALL);

    const membership = await prisma.membership.findFirst({
      where: {
        id: membershipId,
        tenantId: payload.tenantId,
        deletedAt: null
      },
      include: {
        role: {
          select: {
            id: true,
            code: true
          }
        }
      }
    });

    if (!membership) {
      throw new NotFoundError("Üyelik bulunamadı");
    }

    const nextRole = await prisma.role.findFirst({
      where: {
        code: payload.roleCode,
        deletedAt: null,
        OR: [{ tenantId: null }, { tenantId: payload.tenantId }]
      },
      select: {
        id: true,
        code: true,
        name: true
      }
    });

    if (!nextRole) {
      throw new NotFoundError("Rol bulunamadı");
    }

    const updated = await prisma.membership.update({
      where: {
        id: membership.id
      },
      data: {
        roleId: nextRole.id
      },
      select: {
        id: true,
        roleId: true
      }
    });

    await services.auditService.log({
      tenantId: payload.tenantId,
      actorUserId: session.userId,
      action: "member.role.updated",
      resourceType: "membership",
      resourceId: membership.id,
      metadata: {
        previousRoleCode: membership.role.code,
        nextRoleCode: nextRole.code
      }
    });

    return ok({
      membershipId: updated.id,
      roleId: updated.roleId,
      roleCode: nextRole.code,
      roleName: nextRole.name
    });
  } catch (error) {
    return fail(error);
  }
}
