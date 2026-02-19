import { addDays, parseISO } from 'date-fns';
import type { AdvisoryDateResult, LimitationEvent } from '@/lib/litigation/types';
import { addMoney, toMoney } from '@/utils/money';

interface PrescriptionInput {
  startDate: string;
  baseDurationDays: number;
  events: LimitationEvent[];
}

export function calculateAdvisoryLimitationDate(input: PrescriptionInput): AdvisoryDateResult {
  let effectiveDuration = toMoney(input.baseDurationDays);
  let tollingStart: string | null = null;

  const eventsSorted = [...input.events].sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  for (const event of eventsSorted) {
    if (event.eventType === 'tolling_start') {
      tollingStart = event.eventDate;
      continue;
    }

    if (event.eventType === 'tolling_end' && tollingStart) {
      const pauseDays = Math.max(
        0,
        Math.floor((parseISO(event.eventDate).getTime() - parseISO(tollingStart).getTime()) / (1000 * 60 * 60 * 24))
      );
      effectiveDuration = addMoney(effectiveDuration, pauseDays);
      tollingStart = null;
      continue;
    }

    if (event.eventType === 'interruption') {
      effectiveDuration = toMoney(input.baseDurationDays);
    }
  }

  const estimatedDate = addDays(parseISO(input.startDate), Number(effectiveDuration.toFixed(0)));

  return {
    estimatedDate: estimatedDate.toISOString().slice(0, 10),
    advisoryLabel: 'advisory_estimated',
    requiresUserAcceptance: true,
  };
}
