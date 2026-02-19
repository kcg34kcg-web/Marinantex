import { Suspense } from 'react';
import { PortalOtpGate } from '@/components/portal/portal-otp-gate';

export default function PortalOtpPage() {
  return (
    <div className="mx-auto max-w-xl">
      <Suspense fallback={<div className="text-sm text-slate-600">Yükleniyor...</div>}>
        <PortalOtpGate />
      </Suspense>
    </div>
  );
}
