import { z } from 'zod';

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

type NagerHolidayRow = {
  date?: string;
  localName?: string;
  name?: string;
  types?: string[];
  global?: boolean;
  counties?: string[] | null;
};

function toDateOnly(input: Date) {
  return input.toISOString().slice(0, 10);
}

function getYearsInRange(from: string, to: string) {
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));

  if (!Number.isFinite(fromYear) || !Number.isFinite(toYear) || fromYear > toYear) {
    return [] as number[];
  }

  const safeMaxYearSpan = 4;
  const years: number[] = [];
  for (let year = fromYear; year <= toYear && years.length < safeMaxYearSpan; year += 1) {
    years.push(year);
  }

  return years;
}

function isWithinRange(dateOnly: string, from: string, to: string) {
  return dateOnly >= from && dateOnly <= to;
}

async function fetchYearHolidays(year: number): Promise<NagerHolidayRow[]> {
  const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/TR`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    next: {
      revalidate: 60 * 60 * 12,
    },
  });

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload as NagerHolidayRow[];
}

export async function GET(request: Request) {
  const today = toDateOnly(new Date());
  const nextYear = toDateOnly(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));

  const search = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    from: search.get('from') ?? undefined,
    to: search.get('to') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: 'Gecersiz resmi tatil sorgusu.' }, { status: 400 });
  }

  const from = parsed.data.from ?? today;
  const to = parsed.data.to ?? nextYear;
  if (from > to) {
    return Response.json({ error: 'Tarih araligi gecersiz.' }, { status: 400 });
  }

  const years = getYearsInRange(from, to);
  if (years.length === 0) {
    return Response.json({ items: [] });
  }

  const yearlyResults = await Promise.all(years.map((year) => fetchYearHolidays(year)));
  const merged = yearlyResults.flat();

  const items = merged
    .map((item) => {
      const date = item.date?.trim();
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return null;
      }

      if (!isWithinRange(date, from, to)) {
        return null;
      }

      const types = Array.isArray(item.types) ? item.types : [];
      const isOfficialType = types.includes('Public') || types.includes('National') || types.length === 0;
      if (!isOfficialType) {
        return null;
      }

      if (item.global === false && Array.isArray(item.counties) && item.counties.length > 0) {
        return null;
      }

      return {
        id: `holiday-${date}-${item.localName ?? item.name ?? 'tatil'}`,
        date,
        name: item.localName ?? item.name ?? 'Resmi Tatil',
      };
    })
    .filter((item): item is { id: string; date: string; name: string } => Boolean(item))
    .sort((left, right) => left.date.localeCompare(right.date));

  return Response.json({ items });
}
