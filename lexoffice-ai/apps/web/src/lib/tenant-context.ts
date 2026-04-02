import { UnauthorizedError } from "@lexoffice/core";
import { redirect } from "next/navigation";
import { prisma } from "@lexoffice/db";
import { getServerSession } from "./session";

export async function getTenantContext(tenantSlug: string) {
  let session: Awaited<ReturnType<typeof getServerSession>>;
  try {
    session = await getServerSession();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect(`/sign-in?tenantSlug=${encodeURIComponent(tenantSlug)}`);
    }
    throw error;
  }

  let tenant: any;
  try {
    tenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      include: {
        settings: true
      }
    });
  } catch (error) {
    if (!isMissingTenantSettingsColumnError(error)) {
      throw error;
    }

    // Backward-compatible fallback for environments where DB schema is older than code.
    const legacyTenant = await prisma.tenant.findUnique({
      where: { slug: tenantSlug }
    });

    tenant = legacyTenant ? { ...legacyTenant, settings: null } : null;
  }

  if (!tenant || tenant.deletedAt || session.tenantId !== tenant.id) {
    redirect("/sign-in");
  }

  return {
    session,
    tenant
  };
}

function isMissingTenantSettingsColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
  };

  if (candidate.code !== "P2022") {
    return false;
  }

  if (typeof candidate.message !== "string") {
    return false;
  }

  return candidate.message.includes("TenantSettings.");
}
