'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function PortalOtpGate() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') ?? '/portal';
  const [email, setEmail] = useState('muvekkil@example.com');
  const [sessionId, setSessionId] = useState('');
  const [code, setCode] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function sendOtp() {
    setMessage(null);
    const response = await fetch('/api/portal/otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      setMessage('OTP gönderimi başarısız.');
      return;
    }

    const data = (await response.json()) as { sessionId: string; demoOtpCode: string };
    setSessionId(data.sessionId);
    setDemoCode(data.demoOtpCode);
    setMessage('OTP gönderildi. Demo kodu ekranda gösteriliyor.');
  }

  async function verifyOtp() {
    setMessage(null);
    const response = await fetch('/api/portal/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, code }),
    });

    if (!response.ok) {
      setMessage('OTP doğrulama başarısız.');
      return;
    }

    setMessage('Doğrulama başarılı, portala yönlendiriliyorsunuz...');
    router.push(nextPath as Route);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portal Güvenlik Doğrulaması (2FA)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="E-posta" />
        <Button type="button" onClick={sendOtp}>
          OTP Gönder
        </Button>

        <Input value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="Session ID" />
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 haneli kod" maxLength={6} />
        <Button type="button" variant="outline" onClick={verifyOtp}>
          OTP Doğrula
        </Button>

        {demoCode ? <p className="text-xs text-slate-500">Demo OTP kodu: {demoCode}</p> : null}
        {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
