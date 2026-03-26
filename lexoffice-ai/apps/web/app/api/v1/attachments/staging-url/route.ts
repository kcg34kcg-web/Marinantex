import { createAttachmentUploadUrlSchema } from "@lexoffice/contracts";
import { PERMISSIONS } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = createAttachmentUploadUrlSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(session.userId, payload.tenantId, PERMISSIONS.FILE_UPLOAD);

    const result = await services.attachmentSecurityService.createStagedUpload(session.userId, payload);
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
