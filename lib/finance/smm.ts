import type { TaxConfig } from '@/types/finance';
import { addMoney, divMoney, mulMoney, percentToRatio, subMoney, toFixedMoney } from '@/utils/money';

export type TaxpayerStatus = 'consumer' | 'taxpayer';

export interface SmmCalculationInput {
  netAmount: string;
  mode: 'net_to_gross' | 'gross_to_net';
  taxpayerStatus: TaxpayerStatus;
  stopajRatePercent: string;
  kdvRatePercent: string;
  tevkifatEnabled: boolean;
  tevkifatNumerator: string;
  tevkifatDenominator: string;
  taxConfig?: TaxConfig;
}

export interface SmmCalculationResult {
  grossAmount: string;
  stopajAmount: string;
  kdvAmount: string;
  tevkifatAmount: string;
  totalReceivable: string;
}

export function getDefaultStopajByStatus(status: TaxpayerStatus): string {
  return status === 'consumer' ? '0' : '20';
}

export function calculateSmm(input: SmmCalculationInput): SmmCalculationResult {
  const stopajRate = percentToRatio(input.stopajRatePercent);
  const kdvRate = percentToRatio(input.kdvRatePercent);

  const grossAmount =
    input.mode === 'net_to_gross' ? divMoney(input.netAmount, subMoney(1, stopajRate)) : addMoney(0, input.netAmount);

  const stopajAmount = mulMoney(grossAmount, stopajRate);
  const kdvAmount = mulMoney(grossAmount, kdvRate);

  const tevkifatRatio =
    input.tevkifatEnabled && input.tevkifatDenominator !== '0'
      ? divMoney(input.tevkifatNumerator, input.tevkifatDenominator)
      : addMoney(0, 0);

  const tevkifatAmount = mulMoney(kdvAmount, tevkifatRatio);
  const adjustedKdv = subMoney(kdvAmount, tevkifatAmount);
  const totalReceivable = addMoney(grossAmount, adjustedKdv);

  return {
    grossAmount: toFixedMoney(grossAmount),
    stopajAmount: toFixedMoney(stopajAmount),
    kdvAmount: toFixedMoney(kdvAmount),
    tevkifatAmount: toFixedMoney(tevkifatAmount),
    totalReceivable: toFixedMoney(totalReceivable),
  };
}
