import {
  deleteMailFilterRuleSchema,
  updateMailFilterRuleSchema
} from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { prisma } from "@lexoffice/db";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ ruleId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const params = await context.params;
    const payload = (await request.json()) as Record<string, unknown>;
    const input = updateMailFilterRuleSchema.parse({
      ...payload,
      ruleId: params.ruleId
    });

    assertTenantAccess(session.tenantId, input.tenantId);
    await services.rbacService.requirePermission(session.userId, input.tenantId, PERMISSIONS.DOMAIN_MANAGE);

    const existing = await prisma.mailFilterRule.findFirst({
      where: {
        id: input.ruleId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      select: { id: true }
    });

    if (!existing) {
      return fail(new Error("Kural bulunamadı"));
    }

    if (input.mailboxId !== undefined && input.mailboxId !== null) {
      const mailbox = await prisma.mailbox.findFirst({
        where: {
          id: input.mailboxId,
          tenantId: input.tenantId,
          deletedAt: null
        },
        select: { id: true }
      });
      if (!mailbox) {
        return fail(new Error("Kural mailbox seçimi geçersiz"));
      }
    }

    const rule = await prisma.mailFilterRule.update({
      where: { id: input.ruleId },
      data: {
        ...(input.mailboxId !== undefined ? { mailboxId: input.mailboxId } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.fromPattern !== undefined ? { fromPattern: input.fromPattern } : {}),
        ...(input.subjectPattern !== undefined ? { subjectPattern: input.subjectPattern } : {}),
        ...(input.bodyPattern !== undefined ? { bodyPattern: input.bodyPattern } : {}),
        ...(input.hasAttachments !== undefined ? { hasAttachments: input.hasAttachments } : {}),
        ...(input.actionState !== undefined ? { actionState: input.actionState } : {}),
        ...(input.actionMarkRead !== undefined ? { actionMarkRead: input.actionMarkRead } : {}),
        ...(input.actionStar !== undefined ? { actionStar: input.actionStar } : {}),
        ...(input.actionImportant !== undefined ? { actionImportant: input.actionImportant } : {}),
        ...(input.actionLabelName !== undefined ? { actionLabelName: input.actionLabelName } : {}),
        ...(input.actionForwardTo !== undefined ? { actionForwardTo: input.actionForwardTo } : {}),
        ...(input.stopProcessing !== undefined ? { stopProcessing: input.stopProcessing } : {})
      }
    });

    return ok({ rule });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{ ruleId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const params = await context.params;
    const payload = (await request.json()) as Record<string, unknown>;
    const input = deleteMailFilterRuleSchema.parse({
      ...payload,
      ruleId: params.ruleId
    });

    assertTenantAccess(session.tenantId, input.tenantId);
    await services.rbacService.requirePermission(session.userId, input.tenantId, PERMISSIONS.DOMAIN_MANAGE);

    await prisma.mailFilterRule.updateMany({
      where: {
        id: input.ruleId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      data: {
        deletedAt: new Date()
      }
    });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
