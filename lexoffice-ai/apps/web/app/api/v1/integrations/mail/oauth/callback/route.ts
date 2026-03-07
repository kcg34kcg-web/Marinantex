import { NextResponse } from "next/server";
import { AppError, JOB_NAMES, PERMISSIONS } from "@lexoffice/core";
import { verifyMailOAuthState } from "@/lib/mail-oauth-state";
import { getMailSyncQueue } from "@/lib/queue";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";
import { assertTenantAccess } from "@/lib/tenant-access";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const stateValue = requestUrl.searchParams.get("state");
  const providerError = requestUrl.searchParams.get("error");

  if (!stateValue) {
    return NextResponse.redirect(new URL("/sign-in?oauth=missing_state", requestUrl));
  }

  let state: ReturnType<typeof verifyMailOAuthState>;
  try {
    state = verifyMailOAuthState(stateValue);
  } catch {
    return NextResponse.redirect(new URL("/sign-in?oauth=invalid_state", requestUrl));
  }

  const settingsUrl = new URL(`/${state.tenantSlug}/settings/domains`, requestUrl);

  if (providerError) {
    settingsUrl.searchParams.set("oauth", "error");
    settingsUrl.searchParams.set("provider", state.provider);
    settingsUrl.searchParams.set("reason", providerError);
    return NextResponse.redirect(settingsUrl);
  }

  if (!code) {
    settingsUrl.searchParams.set("oauth", "error");
    settingsUrl.searchParams.set("provider", state.provider);
    settingsUrl.searchParams.set("reason", "missing_code");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    const session = await getServerSession();
    assertTenantAccess(session.tenantId, state.tenantId);

    if (session.userId !== state.userId) {
      settingsUrl.searchParams.set("oauth", "error");
      settingsUrl.searchParams.set("provider", state.provider);
      settingsUrl.searchParams.set("reason", "state_user_mismatch");
      return NextResponse.redirect(settingsUrl);
    }

    await services.rbacService.requirePermission(
      session.userId,
      state.tenantId,
      PERMISSIONS.MAILBOX_CONNECT
    );

    const redirectUri = new URL(
      "/api/v1/integrations/mail/oauth/callback",
      process.env.APP_URL ?? requestUrl.origin
    ).toString();
    const { mailbox } = await services.mailIntegrationService.connectMailboxFromOAuth({
      tenantId: state.tenantId,
      actorUserId: session.userId,
      provider: state.provider,
      authCode: code,
      redirectUri
    });

    const jobPayload = await services.mailSyncService.triggerSync(session.userId, {
      tenantId: state.tenantId,
      mailboxId: mailbox.id,
      mode: "initial"
    });

    const queue = getMailSyncQueue();
    await queue.add(JOB_NAMES.MAIL_SYNC_RUN, jobPayload, {
      jobId: `${jobPayload.tenantId}:${jobPayload.mailboxId}:${jobPayload.correlationId}`,
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 3_000
      },
      removeOnComplete: 200,
      removeOnFail: 500
    });

    settingsUrl.searchParams.set("oauth", "success");
    settingsUrl.searchParams.set("provider", state.provider);
    settingsUrl.searchParams.set("mailbox", mailbox.email);
    return NextResponse.redirect(settingsUrl);
  } catch (error) {
    settingsUrl.searchParams.set("oauth", "error");
    settingsUrl.searchParams.set("provider", state.provider);
    settingsUrl.searchParams.set("reason", toReasonCode(error));
    return NextResponse.redirect(settingsUrl);
  }
}

function toReasonCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.code.toLowerCase();
  }

  return "oauth_callback_failed";
}
