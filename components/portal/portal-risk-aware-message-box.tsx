'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function PortalRiskAwareMessageBox({ caseId }: { caseId: string }) {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  async function submitMessage() {
    setStatus(null);
    const response = await fetch('/api/portal/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, caseId }),
    });

    if (!response.ok) {
      setStatus('Mesaj gönderilemedi.');
      return;
    }

    const data = (await response.json()) as { risky: boolean };
    setStatus(data.risky ? 'Mesaj alındı. Ofis ekibine risk alarmı gönderildi.' : 'Mesaj alındı.');
    setMessage('');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mesaj Gönder</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-input bg-white p-3 text-sm"
          placeholder="Dosya ile ilgili mesajınızı yazın"
        />
        <Button type="button" onClick={submitMessage} disabled={!message.trim()}>
          Gönder
        </Button>
        {status ? <p className="text-sm text-slate-600">{status}</p> : null}
      </CardContent>
    </Card>
  );
}
