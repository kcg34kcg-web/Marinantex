import { z } from "zod";
import { ForbiddenError, NotFoundError, PERMISSIONS } from "@lexoffice/core";
import { prisma } from "@lexoffice/db";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";

const deactivateMemberSchema = z.object({
  tenantId: z.string().cuid()
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
    const payload = deactivateMemberSchema.parse(await request.json());

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
      select: {
        id: true,
        userId: true,
        status: true
      }
    });

    if (!membership) {
      throw new NotFoundError("Üyelik bulunamadı");
    }

    if (membership.userId === session.userId) {
      throw new ForbiddenError("Kendi üyeliğinizi bu ekrandan pasifleştiremezsiniz");
    }

    const updated = await prisma.membership.update({
      where: {
        id: membership.id
      },
      data: {
        status: "REMOVED",
        deletedAt: new Date()
      },
      select: {
        id: true,
        status: true
      }
    });

    await services.auditService.log({
      tenantId: payload.tenantId,
      actorUserId: session.userId,
      action: "member.removed",
      resourceType: "membership",
      resourceId: membership.id,
      metadata: {
        previousStatus: membership.status,
        nextStatus: updated.status
      }
    });

    return ok({
      membershipId: updated.id,
      status: updated.status
    });
  } catch (error) {
    return fail(error);
  }
}
