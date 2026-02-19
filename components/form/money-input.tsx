'use client';

import type { InputHTMLAttributes } from 'react';
import { Input } from '@/components/ui/input';

type MoneyInputProps = InputHTMLAttributes<HTMLInputElement>;

export function MoneyInput(props: MoneyInputProps) {
  return <Input inputMode="decimal" {...props} />;
}
