'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AssistantPendingAction } from '@/types/assistant';

interface ConfirmationDialogProps {
  open: boolean;
  action: AssistantPendingAction | null;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmationDialog({ open, action, loading, onCancel, onConfirm }: ConfirmationDialogProps) {
  const [doubleConfirmArmed, setDoubleConfirmArmed] = useState(false);

  useEffect(() => {
    if (!open || !action) {
      setDoubleConfirmArmed(false);
    }
  }, [open, action]);

  if (!open || !action) {
    return null;
  }

  const riskSummary =
    action.toolName === 'tasks.create' || action.toolName === 'calendar.extract_tasks'
      ? 'Bu işlem yeni kayıt oluşturur. Geri alma penceresi sınırlı süre için açık kalır.'
      : 'Bu işlem sistemde değişiklik yapabilir. Devam etmeden önce önizlemeyi kontrol et.';

  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/35 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--main-border,var(--border))] bg-[var(--main-surface-2,var(--surface))] p-4 shadow-xl">
        <div className="mb-3 flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-orange-600" />
          <div>
            <h3 className="text-sm font-semibold text-[var(--main-text,var(--text))]">Onay gerekli</h3>
            <p className="text-xs text-[var(--main-muted,var(--secondary))]">{action.summary}</p>
          </div>
        </div>
        <p className="mb-3 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1 text-[11px] text-orange-700">{riskSummary}</p>

        <pre className="max-h-40 overflow-auto rounded-xl border border-[var(--main-border,var(--border))] bg-[color-mix(in_srgb,var(--main-surface-1,var(--surface)),white_8%)] p-2 text-[11px] text-[var(--main-muted,var(--secondary))]">
          {JSON.stringify(action.preview, null, 2)}
        </pre>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg border border-[var(--main-border,var(--border))] px-3 py-1.5 text-xs text-[var(--main-muted,var(--secondary))]"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={() => {
              if (!doubleConfirmArmed) {
                setDoubleConfirmArmed(true);
                return;
              }
              onConfirm();
            }}
            disabled={loading}
            className="rounded-lg border border-[color-mix(in_srgb,var(--primary),white_35%)] bg-[color-mix(in_srgb,var(--primary),white_85%)] px-3 py-1.5 text-xs font-semibold text-[var(--primary)]"
          >
            {loading ? 'Çalışıyor...' : doubleConfirmArmed ? 'Son onay: Çalıştır' : '1/2 Onayla'}
          </button>
        </div>
      </div>
    </div>
  );
}
