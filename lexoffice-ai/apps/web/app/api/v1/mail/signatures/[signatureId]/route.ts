import { z } from "zod";
import { PERMISSIONS, NotFoundError } from "@lexoffice/core";
import { prisma } from "@lexoffice/db";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

const updateSignatureSchema = z.object({
  tenantId: z.string().cuid(),
  name: z.string().min(1).max(120).optional(),
  htmlBody: z.string().min(1).max(20_000).optional(),
  textBody: z.string().max(20_000).optional(),
  isDefault: z.boolean().optional()
});

const deleteSignatureSchema = z.object({
  tenantId: z.string().cuid()
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ signatureId: string }> }
) {
  try {
    const session = await getServerSession();
    const { signatureId } = await params;
    const payload = updateSignatureSchema.parse(await request.json());
    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAILBOX_VIEW);

    const existing = await prisma.signature.findFirst({
      where: {
        id: signatureId,
        tenantId: payload.tenantId
      },
      select: {
        id: true
      }
    });

    if (!existing) {
      throw new NotFoundError("Güncellenecek imza bulunamadı");
    }

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

      return tx.signature.update({
        where: {
          id: existing.id
        },
        data: {
          ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
          ...(payload.htmlBody !== undefined ? { htmlBody: payload.htmlBody } : {}),
          ...(payload.textBody !== undefined ? { textBody: payload.textBody.trim() || null } : {}),
          ...(payload.isDefault !== undefined ? { isDefault: payload.isDefault } : {})
        },
        select: {
          id: true,
          name: true,
          htmlBody: true,
          textBody: true,
          isDefault: true,
          updatedAt: true
        }
      });
    });

    return ok({ signature });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ signatureId: string }> }
) {
  try {
    const session = await getServerSession();
    const { signatureId } = await params;
    const payload = deleteSignatureSchema.parse(await request.json());
    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAILBOX_VIEW);

    const existing = await prisma.signature.findFirst({
      where: {
        id: signatureId,
        tenantId: payload.tenantId
      },
      select: {
        id: true,
        isDefault: true
      }
    });

    if (!existing) {
      throw new NotFoundError("Silinecek imza bulunamadı");
    }

    await prisma.$transaction(async (tx) => {
      await tx.signature.delete({
        where: {
          id: existing.id
        }
      });

      if (!existing.isDefault) {
        return;
      }

      const fallback = await tx.signature.findFirst({
        where: {
          tenantId: payload.tenantId
        },
        orderBy: [{ updatedAt: "desc" }]
      });

      if (!fallback) {
        return;
      }

      await tx.signature.update({
        where: { id: fallback.id },
        data: { isDefault: true }
      });
    });

    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
