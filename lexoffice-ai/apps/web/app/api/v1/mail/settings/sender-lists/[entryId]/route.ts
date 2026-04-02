import { deleteSenderListEntrySchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { prisma } from "@lexoffice/db";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{ entryId: string }>;
  }
) {
  try {
    const session = await getServerSession();
    const params = await context.params;
    const payload = (await request.json()) as Record<string, unknown>;
    const input = deleteSenderListEntrySchema.parse({
      ...payload,
      entryId: params.entryId
    });

    assertTenantAccess(session.tenantId, input.tenantId);
    await services.rbacService.requirePermission(session.userId, input.tenantId, PERMISSIONS.DOMAIN_MANAGE);

    await prisma.mailSenderListEntry.updateMany({
      where: {
        id: input.entryId,
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
