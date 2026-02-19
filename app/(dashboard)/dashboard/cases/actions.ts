'use server';

import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';
import { precomputeMustCites } from '@/lib/rag/precompute';
import type { ActionResult } from '@/types';

const createCaseSchema = z.object({
  title: z.string().min(5).max(200),
  clientId: z.string().uuid().nullable(),
  caseType: z.string().min(3).max(100),
});

interface CreateCaseData {
  caseId: string;
}

export async function createCaseAction(
  _previousState: ActionResult<CreateCaseData> | undefined,
  formData: FormData
): Promise<ActionResult<CreateCaseData>> {
  try {
    const payload = createCaseSchema.safeParse({
      title: formData.get('title'),
      clientId: formData.get('clientId') || null,
      caseType: formData.get('caseType'),
    });

    if (!payload.success) {
      return { success: false, error: 'Lütfen dosya bilgilerini doğru girin.' };
    }

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: 'Oturum doğrulanamadı.' };
    }

    const { data: createdCase, error: createError } = await supabase
      .from('cases')
      .insert({
        title: payload.data.title,
        lawyer_id: user.id,
        client_id: payload.data.clientId,
        case_type: payload.data.caseType,
      })
      .select('id')
      .single();

    if (createError || !createdCase) {
      return { success: false, error: 'Dosya oluşturulamadı.' };
    }

    try {
      await precomputeMustCites(createdCase.id, payload.data.caseType);
    } catch {
      return {
        success: true,
        data: { caseId: createdCase.id },
        error: 'Dosya oluşturuldu ancak emsal ön-yükleme tamamlanamadı.',
      };
    }

    return {
      success: true,
      data: { caseId: createdCase.id },
    };
  } catch {
    return { success: false, error: 'Beklenmeyen bir hata oluştu.' };
  }
}
