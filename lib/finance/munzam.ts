import { mulMoney, subMoney, percentToRatio, toFixedMoney } from '@/utils/money';

export interface MunzamInput {
  principal: string;
  inflationRatePercent: string;
  legalInterestRatePercent: string;
  usdChangePercent?: string;
  goldChangePercent?: string;
}

export interface MunzamResult {
  inflationAdjusted: string;
  legalInterestAdjusted: string;
  munzamDamage: string;
  usdBenchmark?: string;
  goldBenchmark?: string;
}

export function calculateMunzamDamage(input: MunzamInput): MunzamResult {
  const inflationAdjusted = mulMoney(input.principal, percentToRatio(input.inflationRatePercent));
  const legalInterestAdjusted = mulMoney(input.principal, percentToRatio(input.legalInterestRatePercent));
  const munzamDamage = subMoney(inflationAdjusted, legalInterestAdjusted);

  const usdBenchmark = input.usdChangePercent
    ? toFixedMoney(mulMoney(input.principal, percentToRatio(input.usdChangePercent)))
    : undefined;

  const goldBenchmark = input.goldChangePercent
    ? toFixedMoney(mulMoney(input.principal, percentToRatio(input.goldChangePercent)))
    : undefined;

  return {
    inflationAdjusted: toFixedMoney(inflationAdjusted),
    legalInterestAdjusted: toFixedMoney(legalInterestAdjusted),
    munzamDamage: toFixedMoney(munzamDamage),
    usdBenchmark,
    goldBenchmark,
  };
}
