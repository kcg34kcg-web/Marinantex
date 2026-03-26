import { z } from "zod";
import { fail, ok } from "@/lib/http";
import { getServerSession } from "@/lib/session";
import { services } from "@/lib/services";

const eraseRequestSchema = z.object({
  reason: z.string().max(500).optional()
});

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    const payload = eraseRequestSchema.parse(await request.json().catch(() => ({})));

    if (!session.tenantId) {
      return ok({ queued: false });
    }

    const reason = payload.reason?.trim();

    await services.securityEventService.record({
      tenantId: session.tenantId,
      userId: session.userId,
      eventType: "privacy.erase.requested",
      severity: "MEDIUM",
      description: "Kullanıcı kişisel veri silme talebi oluşturdu",
      payload: {
        reason: reason?.length ? reason : null
      }
    });

    await services.auditService.log({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "privacy.erase.requested",
      resourceType: "user",
      resourceId: session.userId,
      metadata: {
        reason: reason?.length ? reason : null
      }
    });

    return ok({ queued: true });
  } catch (error) {
    return fail(error);
  }
}
