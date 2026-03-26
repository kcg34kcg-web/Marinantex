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

  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    include: {
      settings: true
    }
  });

  if (!tenant || tenant.deletedAt || session.tenantId !== tenant.id) {
    redirect("/sign-in");
  }

  return {
    session,
    tenant
  };
}
