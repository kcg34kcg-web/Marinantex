'use client';

import { Input } from '@/components/ui/input';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}

export function DateRangePicker({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: DateRangePickerProps) {
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <Input type="date" value={startDate} onChange={(event) => onStartDateChange(event.target.value)} />
      <Input type="date" value={endDate} onChange={(event) => onEndDateChange(event.target.value)} />
    </div>
  );
}
