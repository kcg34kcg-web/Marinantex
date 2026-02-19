import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

export function formatDateTR(dateInput: Date | string): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;

  const istanbulFormatted = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

  const [day, month, year] = istanbulFormatted.split('.');
  const safeDate = new Date(`${year}-${month}-${day}T00:00:00+03:00`);

  return format(safeDate, 'dd.MM.yyyy', { locale: tr });
}
