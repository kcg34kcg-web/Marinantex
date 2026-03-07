import { redirect } from "next/navigation";
import { prisma } from "@lexoffice/db";
import { getServerSession } from "./session";

export async function getTenantContext(tenantSlug: string) {
  const session = await getServerSession();

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
