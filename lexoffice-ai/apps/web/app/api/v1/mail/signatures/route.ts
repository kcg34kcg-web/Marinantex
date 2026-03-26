import { z } from "zod";
import { PERMISSIONS } from "@lexoffice/core";
import { prisma } from "@lexoffice/db";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

const createSignatureSchema = z.object({
  tenantId: z.string().cuid(),
  name: z.string().min(1).max(120),
  htmlBody: z.string().min(1).max(20_000),
  textBody: z.string().max(20_000).optional(),
  isDefault: z.boolean().default(false)
});

export async function GET(request: Request) {
  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId") ?? "";
    assertTenantAccess(session.tenantId, tenantId);
    await services.rbacService.requirePermission(session.userId, tenantId, PERMISSIONS.MAILBOX_VIEW);

    const signatures = await prisma.signature.findMany({
      where: {
        tenantId
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        htmlBody: true,
        textBody: true,
        isDefault: true,
        updatedAt: true
      }
    });

    return ok({ signatures });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = createSignatureSchema.parse(await request.json());
    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAILBOX_VIEW);

    const signature = await prisma.$transaction(async (tx) => {
      if (payload.isDefault) {
        await tx.signature.updateMany({
          where: {
            tenantId: payload.tenantId,
            isDefault: true
          },
          data: {
            isDefault: false
          }
        });
      }

      return tx.signature.create({
        data: {
          tenantId: payload.tenantId,
          name: payload.name.trim(),
          htmlBody: payload.htmlBody,
          textBody: payload.textBody?.trim() || null,
          isDefault: payload.isDefault,
          createdById: session.userId
        },
        select: {
          id: true,
          name: true,
          htmlBody: true,
          textBody: true,
          isDefault: true
        }
      });
    });

    return ok({ signature });
  } catch (error) {
    return fail(error);
  }
}
