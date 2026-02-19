import type { ExecutionRateOverride } from '@/types/finance';
import { addMoney, mulMoney, percentToRatio, toFixedMoney } from '@/utils/money';

export interface ExecutionCalculationInput {
  collectedAmount: string;
  tahsilHarciRatePercent: string;
  prisonFeeEnabled: boolean;
  prisonFeeRatePercent: string;
  rateOverrides?: ExecutionRateOverride;
}

export interface ExecutionCalculationResult {
  tahsilHarciAmount: string;
  prisonFeeAmount: string;
  totalCost: string;
}

export function calculateExecutionCosts(input: ExecutionCalculationInput): ExecutionCalculationResult {
  const tahsilRate = percentToRatio(input.rateOverrides?.tahsilHarciRatePercent ?? input.tahsilHarciRatePercent);
  const tahsilHarciAmount = mulMoney(input.collectedAmount, tahsilRate);

  const prisonRate = percentToRatio(input.rateOverrides?.prisonFeeRatePercent ?? input.prisonFeeRatePercent);
  const prisonFeeAmount = input.prisonFeeEnabled ? mulMoney(input.collectedAmount, prisonRate) : addMoney(0, 0);

  const totalCost = addMoney(tahsilHarciAmount, prisonFeeAmount);

  return {
    tahsilHarciAmount: toFixedMoney(tahsilHarciAmount),
    prisonFeeAmount: toFixedMoney(prisonFeeAmount),
    totalCost: toFixedMoney(totalCost),
  };
}

export function getExecutionWarnings(assetType: string): string[] {
  const normalized = assetType.toLocaleLowerCase('tr-TR');

  if (normalized.includes('emekli')) {
    return ['Emekli Maaşı - İİK 83/a uyarınca borçlunun açık muvafakati gerekli olabilir.'];
  }

  if (normalized.includes('aile konutu')) {
    return ['Aile konutu üzerinde işlemde TMK koruma hükümleri yönünden ayrıca inceleme yapınız.'];
  }

  return ['Dosya özelinde harç ve masraf oranlarını güncel mevzuat ile karşılaştırınız.'];
}
