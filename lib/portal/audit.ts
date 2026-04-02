import { createHash } from 'node:crypto';
import { createAdminClient } from '@/utils/supabase/admin';

export interface PortalAuditEventInput {
  tenantId: string;
  actorUserId: string | null;
  eventType: string;
  objectType: string;
  objectId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  result?: 'success' | 'denied' | 'error';
  reasonCode?: string | null;
  dataClassification?: string;
  metadata?: Record<string, unknown>;
}

export function extractRequestIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  return forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown';
}

export function hashUserAgent(input: string | null | undefined): string {
  return createHash('sha256').update(input?.trim() || 'unknown').digest('hex');
}

export async function writePortalAuditEvent(input: PortalAuditEventInput): Promise<void> {
  const admin = createAdminClient();
  const result = await admin.from('audit_logs').insert({
    tenant_id: input.tenantId,
    actor_user_id: input.actorUserId,
    event_type: input.eventType,
    object_type: input.objectType,
    object_id: input.objectId ?? null,
    request_id: input.requestId ?? null,
    ip_address: input.ipAddress ?? null,
    user_agent_hash: hashUserAgent(input.userAgent),
    result: input.result ?? 'success',
    reason_code: input.reasonCode ?? null,
    data_classification: input.dataClassification ?? 'general',
    metadata: input.metadata ?? {},
  });

  if (!result.error) {
    return;
  }

  if (result.error.code !== '42P01') {
    throw result.error;
  }

  await admin.from('app_audit_logs').insert({
    actor_user_id: input.actorUserId,
    action: input.eventType,
    entity_type: input.objectType,
    entity_id: input.objectId ?? null,
    metadata: {
      tenantId: input.tenantId,
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgentHash: hashUserAgent(input.userAgent),
      result: input.result ?? 'success',
      reasonCode: input.reasonCode ?? null,
      dataClassification: input.dataClassification ?? 'general',
      ...(input.metadata ?? {}),
    },
  });
}

