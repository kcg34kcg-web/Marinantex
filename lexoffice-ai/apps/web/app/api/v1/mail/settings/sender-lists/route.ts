import {
  createSenderListEntrySchema,
  listSenderListEntriesSchema
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
    const input = listSenderListEntriesSchema.parse({
      tenantId: searchParams.get("tenantId") ?? "",
      kind: searchParams.get("kind") ?? undefined
    });

    assertTenantAccess(session.tenantId, input.tenantId);
    await services.rbacService.requirePermission(session.userId, input.tenantId, PERMISSIONS.DOMAIN_MANAGE);

    const entries = await prisma.mailSenderListEntry.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        ...(input.kind ? { kind: input.kind } : {})
      },
      orderBy: [{ kind: "asc" }, { emailOrDomain: "asc" }]
    });

    return ok({ entries });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const input = createSenderListEntrySchema.parse(await request.json());

    assertTenantAccess(session.tenantId, input.tenantId);
    await services.rbacService.requirePermission(session.userId, input.tenantId, PERMISSIONS.DOMAIN_MANAGE);

    const entry = await prisma.mailSenderListEntry.upsert({
      where: {
        tenantId_kind_emailOrDomain: {
          tenantId: input.tenantId,
          kind: input.kind,
          emailOrDomain: input.emailOrDomain
        }
      },
      create: {
        tenantId: input.tenantId,
        kind: input.kind,
        emailOrDomain: input.emailOrDomain,
        note: input.note ?? null,
        createdById: session.userId
      },
      update: {
        note: input.note ?? null,
        deletedAt: null
      }
    });

    return ok({ entry });
  } catch (error) {
    return fail(error);
  }
}
