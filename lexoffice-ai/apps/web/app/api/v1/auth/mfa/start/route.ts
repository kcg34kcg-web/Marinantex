import { startMfaEnrollmentSchema } from "@lexoffice/contracts";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = startMfaEnrollmentSchema.parse(await request.json());

    assertTenantAccess(session.tenantId, payload.tenantId);

    const result = await services.authService.startMfaEnrollment(session.userId, payload);
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
