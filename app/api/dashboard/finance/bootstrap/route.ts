import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { loadFinanceScopeData, mapTaxConfigRow } from '@/lib/dashboard/finance';
import type { FinanceBootstrapResponse } from '@/types/finance-ops';

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  try {
    const admin = createAdminClient();
    const [scopeData, taxConfigResult] = await Promise.all([
      loadFinanceScopeData(admin, {
        userId: access.userId,
        role: access.role,
        bureauId: access.bureauId,
      }),
      admin
        .from('finance_tax_configs')
        .select(
          'id, vat_rate, withholding_rate, estimated_income_tax_rate, min_billing_minutes, billing_rounding_minutes, default_currency',
        )
        .eq('bureau_id', access.bureauId)
        .maybeSingle(),
    ]);

    const response: FinanceBootstrapResponse = {
      nowIso: new Date().toISOString(),
      cases: scopeData.cases,
      clients: scopeData.clients,
      teamMembers: scopeData.teamMembers,
      taxConfig:
        taxConfigResult.error || !taxConfigResult.data
          ? null
          : mapTaxConfigRow(taxConfigResult.data as Record<string, unknown>),
    };

    return Response.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Finans başlangıç verileri alınamadı.';
    return Response.json({ error: message }, { status: 500 });
  }
}
