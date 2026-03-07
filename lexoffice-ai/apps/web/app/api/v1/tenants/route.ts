import { createTenantSchema } from "@lexoffice/contracts";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = createTenantSchema.parse(await request.json());

    const tenant = await services.tenantService.createTenant(session.userId, payload);
    return ok({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug
    });
  } catch (error) {
    return fail(error);
  }
}
