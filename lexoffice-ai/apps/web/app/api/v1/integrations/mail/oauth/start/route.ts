import { prisma } from "@lexoffice/db";
import { startMailboxOAuthSchema } from "@lexoffice/contracts";
import { PERMISSIONS, NotFoundError } from "@lexoffice/core";
import { fail, ok } from "@/lib/http";
import { createMailOAuthState } from "@/lib/mail-oauth-state";
import { getRequestMeta, getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function GET(request: Request) {
  const meta = await getRequestMeta();

  try {
    const session = await getServerSession();
    const { searchParams } = new URL(request.url);

    const payload = startMailboxOAuthSchema.parse({
      tenantId: searchParams.get("tenantId") ?? "",
      provider: searchParams.get("provider") ?? "",
      emailHint: searchParams.get("emailHint") ?? undefined
    });

    assertTenantAccess(session.tenantId, payload.tenantId);
    await services.rbacService.requirePermission(
      session.userId,
      payload.tenantId,
      PERMISSIONS.MAILBOX_CONNECT
    );

    const tenant = await prisma.tenant.findFirst({
      where: {
        id: payload.tenantId,
        deletedAt: null
      },
      select: {
        slug: true
      }
    });

    if (!tenant) {
      throw new NotFoundError("Tenant bulunamadı");
    }

    const requestUrl = new URL(request.url);
    const appUrl = process.env.APP_URL ?? `${requestUrl.protocol}//${requestUrl.host}`;
    const redirectUri = new URL("/api/v1/integrations/mail/oauth/callback", appUrl).toString();

    const state = createMailOAuthState({
      tenantId: payload.tenantId,
      tenantSlug: tenant.slug,
      userId: session.userId,
      provider: payload.provider,
      ...(payload.emailHint ? { emailHint: payload.emailHint } : {})
    });

    const authorizationUrl = services.mailIntegrationService.buildOAuthAuthorizationUrl({
      provider: payload.provider,
      redirectUri,
      state,
      ...(payload.emailHint ? { emailHint: payload.emailHint } : {})
    });

    return ok(
      {
        authorizationUrl,
        provider: payload.provider,
        redirectUri
      },
      meta.requestId
    );
  } catch (error) {
    return fail(error, meta.requestId);
  }
}
