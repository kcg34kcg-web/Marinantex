import { addDays, differenceInCalendarDays, isAfter, isBefore, parseISO } from 'date-fns';
import type { InterestPeriod } from '@/types/finance';
import { addMoney, divMoney, mulMoney, percentToRatio, toFixedMoney } from '@/utils/money';

export interface InterestRateRow {
  effective_date: string;
  rate_annual: string;
}

export interface InterestCalculationInput {
  principal: string;
  startDate: string;
  endDate: string;
  rateRows: InterestRateRow[];
}

export interface InterestSliceResult {
  period: InterestPeriod;
  days: number;
  interestAmount: string;
}

export interface InterestCalculationResult {
  slices: InterestSliceResult[];
  totalInterest: string;
}

export function slicePeriodsByRate(input: InterestCalculationInput): InterestSliceResult[] {
  const start = parseISO(input.startDate);
  const end = parseISO(input.endDate);

  const sortedRates = [...input.rateRows].sort((a, b) => a.effective_date.localeCompare(b.effective_date));

  const slices: InterestSliceResult[] = [];

  for (let index = 0; index < sortedRates.length; index += 1) {
    const currentRate = sortedRates[index];
    const nextRate = sortedRates[index + 1];

    const periodStart = parseISO(currentRate.effective_date);
    const nextStart = nextRate ? parseISO(nextRate.effective_date) : null;

    const sliceStart = isBefore(periodStart, start) ? start : periodStart;
    const rawSliceEnd = nextStart ? addDays(nextStart, -1) : end;
    const sliceEnd = isAfter(rawSliceEnd, end) ? end : rawSliceEnd;

    if (isAfter(sliceStart, end) || isAfter(sliceStart, sliceEnd)) {
      continue;
    }

    const dayCount = differenceInCalendarDays(sliceEnd, sliceStart) + 1;
    const annualRateRatio = percentToRatio(currentRate.rate_annual);
    const yearFraction = divMoney(dayCount, 365);
    const interestAmount = mulMoney(mulMoney(input.principal, annualRateRatio), yearFraction);

    slices.push({
      period: {
        startDate: sliceStart.toISOString().slice(0, 10),
        endDate: sliceEnd.toISOString().slice(0, 10),
        annualRatePercent: currentRate.rate_annual,
      },
      days: dayCount,
      interestAmount: toFixedMoney(interestAmount),
    });
  }

  return slices;
}

export function calculateVariableInterest(input: InterestCalculationInput): InterestCalculationResult {
  const slices = slicePeriodsByRate(input);

  const totalInterest = slices.reduce((accumulator, slice) => addMoney(accumulator, slice.interestAmount), addMoney(0, 0));

  return {
    slices,
    totalInterest: toFixedMoney(totalInterest),
  };
}
