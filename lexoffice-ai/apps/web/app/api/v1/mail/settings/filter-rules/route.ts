import {
  createMailFilterRuleSchema,
  listMailFilterRulesSchema
} from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { prisma } from "@lexoffice/db";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const input = listMailFilterRulesSchema.parse({
      tenantId: searchParams.get("tenantId") ?? "",
      mailboxId: searchParams.get("mailboxId") ?? undefined
    });

    assertTenantAccess(session.tenantId, input.tenantId);
    await services.rbacService.requirePermission(session.userId, input.tenantId, PERMISSIONS.DOMAIN_MANAGE);

    const rules = await prisma.mailFilterRule.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        ...(input.mailboxId ? { mailboxId: input.mailboxId } : {})
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
    });

    return ok({ rules });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const input = createMailFilterRuleSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, input.tenantId);
    await services.rbacService.requirePermission(session.userId, input.tenantId, PERMISSIONS.DOMAIN_MANAGE);

    if (input.mailboxId) {
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

    const rule = await prisma.mailFilterRule.create({
      data: {
        tenantId: input.tenantId,
        mailboxId: input.mailboxId ?? null,
        name: input.name.trim(),
        enabled: input.enabled,
        priority: input.priority,
        fromPattern: input.fromPattern,
        subjectPattern: input.subjectPattern,
        bodyPattern: input.bodyPattern,
        hasAttachments: input.hasAttachments ?? null,
        actionState: input.actionState ?? null,
        actionMarkRead: input.actionMarkRead,
        actionStar: input.actionStar,
        actionImportant: input.actionImportant,
        actionLabelName: input.actionLabelName,
        actionForwardTo: input.actionForwardTo,
        stopProcessing: input.stopProcessing,
        createdById: session.userId
      }
    });

    return ok({ rule });
  } catch (error) {
    return fail(error);
  }
}
