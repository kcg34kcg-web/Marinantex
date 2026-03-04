import type { SupabaseClient } from '@supabase/supabase-js';

interface AuditPayload {
  action: string;
  entityType: string;
  entityId?: string | null;
  actorUserId: string;
  metadata?: Record<string, unknown>;
}

export async function logDashboardAudit(
  supabase: SupabaseClient,
  payload: AuditPayload,
): Promise<void> {
  const insertResult = await supabase.from('app_audit_logs').insert({
    actor_user_id: payload.actorUserId,
    action: payload.action,
    entity_type: payload.entityType,
    entity_id: payload.entityId ?? null,
    metadata: payload.metadata ?? {},
  });

  if (insertResult.error) {
    // Audit insert must not block user flow in MVP.
    console.error('audit_insert_failed', insertResult.error.message);
  }
}

