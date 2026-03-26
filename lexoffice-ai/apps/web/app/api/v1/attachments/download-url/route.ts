import { createAttachmentDownloadTokenSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = createAttachmentDownloadTokenSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.MAILBOX_VIEW);

    const signed = await services.attachmentSecurityService.createSignedDownloadToken(session.userId, payload);

    return ok({
      downloadUrl: `/api/v1/attachments/download/signed?token=${encodeURIComponent(signed.token)}`,
      expiresAt: signed.expiresAt
    });
  } catch (error) {
    return fail(error);
  }
}
