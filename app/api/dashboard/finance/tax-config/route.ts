import { z } from 'zod';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { createAdminClient } from '@/utils/supabase/admin';
import { mapTaxConfigRow } from '@/lib/dashboard/finance';

const updateSchema = z
  .object({
    vatRate: z.coerce.number().min(0).max(100).optional(),
    withholdingRate: z.coerce.number().min(0).max(100).optional(),
    estimatedIncomeTaxRate: z.coerce.number().min(0).max(100).optional(),
    minBillingMinutes: z.coerce.number().int().min(0).max(480).optional(),
    billingRoundingMinutes: z.coerce.number().int().min(1).max(120).optional(),
    defaultCurrency: z.string().trim().min(3).max(8).optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'Guncellenecek en az bir alan gereklidir.',
  });

async function ensureTableAvailable(admin: ReturnType<typeof createAdminClient>) {
  const probe = await admin.from('finance_tax_configs').select('id').limit(1);
  if (probe.error?.code === '42P01') {
    throw new Error('Finance tablolari hazir degil. rag_v2_step33_finance_ops_core.sql migrationini calistirin.');
  }
}

async function ensureConfigRow(admin: ReturnType<typeof createAdminClient>, bureauId: string, userId: string) {
  const existingResult = await admin
    .from('finance_tax_configs')
    .select(
      'id, vat_rate, withholding_rate, estimated_income_tax_rate, min_billing_minutes, billing_rounding_minutes, default_currency',
    )
    .eq('bureau_id', bureauId)
    .maybeSingle();

  if (existingResult.data && !existingResult.error) {
    return existingResult.data;
  }

  const insertResult = await admin
    .from('finance_tax_configs')
    .insert({
      bureau_id: bureauId,
      vat_rate: 20,
      withholding_rate: 20,
      estimated_income_tax_rate: 25,
      min_billing_minutes: 6,
      billing_rounding_minutes: 6,
      default_currency: 'TRY',
      created_by: userId,
      updated_by: userId,
    })
    .select(
      'id, vat_rate, withholding_rate, estimated_income_tax_rate, min_billing_minutes, billing_rounding_minutes, default_currency',
    )
    .single();

  if (insertResult.error || !insertResult.data) {
    throw new Error('Vergi ayari olusturulamadi.');
  }

  return insertResult.data;
}

export async function GET() {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  try {
    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const row = await ensureConfigRow(admin, access.bureauId, access.userId);
    return Response.json({ item: mapTaxConfigRow(row as Record<string, unknown>) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vergi ayarlari alinamadi.';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return Response.json({ error: access.message }, { status: access.status });
  }

  try {
    const payload = updateSchema.safeParse(await request.json());
    if (!payload.success) {
      return Response.json({ error: 'Gecersiz vergi ayari guncelleme verisi.' }, { status: 400 });
    }

    const admin = createAdminClient();
    await ensureTableAvailable(admin);

    const row = await ensureConfigRow(admin, access.bureauId, access.userId);

    const updateResult = await admin
      .from('finance_tax_configs')
      .update({
        vat_rate: payload.data.vatRate ?? row.vat_rate,
        withholding_rate: payload.data.withholdingRate ?? row.withholding_rate,
        estimated_income_tax_rate: payload.data.estimatedIncomeTaxRate ?? row.estimated_income_tax_rate,
        min_billing_minutes: payload.data.minBillingMinutes ?? row.min_billing_minutes,
        billing_rounding_minutes: payload.data.billingRoundingMinutes ?? row.billing_rounding_minutes,
        default_currency: payload.data.defaultCurrency ?? row.default_currency,
        updated_by: access.userId,
      })
      .eq('id', row.id)
      .eq('bureau_id', access.bureauId)
      .select(
        'id, vat_rate, withholding_rate, estimated_income_tax_rate, min_billing_minutes, billing_rounding_minutes, default_currency',
      )
      .single();

    if (updateResult.error || !updateResult.data) {
      return Response.json({ error: 'Vergi ayarlari guncellenemedi.' }, { status: 500 });
    }

    return Response.json({ item: mapTaxConfigRow(updateResult.data as Record<string, unknown>) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vergi ayarlari guncellenemedi.';
    return Response.json({ error: message }, { status: 500 });
  }
}
