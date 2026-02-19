import { addDays, isWeekend, parseISO } from 'date-fns';

const fixedHolidaySet = new Set(['01-01', '23-04', '01-05', '19-05', '15-07', '30-08', '29-10']);

export interface HmkDeadlineResult {
  estimatedDate: string;
  warning: string;
}

function isFixedHoliday(date: Date): boolean {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return fixedHolidaySet.has(`${month}-${day}`);
}

export function calculateEstimatedHmkDeadline(serviceDateIso: string, durationDays: number): HmkDeadlineResult {
  let cursor = addDays(parseISO(serviceDateIso), durationDays);

  while (isWeekend(cursor) || isFixedHoliday(cursor)) {
    cursor = addDays(cursor, 1);
  }

  return {
    estimatedDate: cursor.toISOString().slice(0, 10),
    warning:
      'Sistem tahmini süreyi hesaplamıştır. Resmî tatil ve adli tatil değişikliklerini kontrol ederek onaylayınız.',
  };
}
