import type { AssistantProactiveSignal } from '@/types/assistant';

interface QuietHoursInput {
  start: number;
  end: number;
  hour: number;
}

interface WeatherSnapshot {
  isRainLikely: boolean;
  description: string;
}

export function isWithinQuietHours(input: QuietHoursInput) {
  const { start, end, hour } = input;
  if (start === end) {
    return false;
  }
  if (start < end) {
    return hour >= start && hour < end;
  }
  return hour >= start || hour < end;
}

export function buildSignalId(prefix: string, now: Date) {
  const day = now.toISOString().slice(0, 10);
  const hour = String(now.getHours()).padStart(2, '0');
  return `${prefix}:${day}:${hour}`;
}

export function buildBusyCheckSignal(now: Date): AssistantProactiveSignal {
  return {
    id: buildSignalId('wellbeing', now),
    level: 'info',
    message: 'Bir süredir yoğunsun. 2 dakikalık kısa bir mola ister misin?',
    suggestion: 'İstersen önce bugünkü öncelikleri tek maddede özetleyeyim.',
  };
}

export function buildEndOfDaySignal(now: Date, payload: { completed: number; open: number; overdue: number }): AssistantProactiveSignal {
  return {
    id: buildSignalId('day-close', now),
    level: 'info',
    message: `Gün kapanışı: ${payload.completed} tamamlanan, ${payload.open} açık ve ${payload.overdue} geciken görev var.`,
    suggestion: 'İstersen yarın sabah için 3 maddelik eylem planı oluşturayım.',
    route: '/dashboard/tasks',
  };
}

export function buildWeatherCourtSignal(now: Date, meetingTitle: string, weather: WeatherSnapshot): AssistantProactiveSignal {
  return {
    id: buildSignalId('weather-court', now),
    level: 'critical',
    message: `Yaklaşan toplantı: "${meetingTitle}". Hava uyarısı: ${weather.description}. Dışarı çıkacaksan şemsiyeni almanı öneririm.`,
    suggestion: 'İstersen toplantıdan 15 dakika önce tekrar hatırlatayım.',
    route: '/dashboard/calendar',
  };
}

export async function fetchWeatherSnapshot(city: string): Promise<WeatherSnapshot | null> {
  try {
    const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'User-Agent': 'babylexit-assistant/1.0' },
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      current_condition?: Array<{ weatherDesc?: Array<{ value?: string }> }>;
      weather?: Array<{ hourly?: Array<{ chanceofrain?: string }> }>;
    };

    const description =
      payload.current_condition?.[0]?.weatherDesc?.[0]?.value?.trim() ||
      'yağış riski tespit edildi';
    const upcomingHourly = payload.weather?.[0]?.hourly ?? [];
    const rainChanceMax = upcomingHourly
      .slice(0, 3)
      .map((item) => Number.parseInt(item.chanceofrain ?? '0', 10))
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => Math.max(max, value), 0);

    const lowered = description.toLocaleLowerCase('tr-TR');
    const isRainByText =
      lowered.includes('rain') ||
      lowered.includes('shower') ||
      lowered.includes('drizzle') ||
      lowered.includes('yağmur') ||
      lowered.includes('sag') ||
      lowered.includes('saganak');

    return {
      isRainLikely: isRainByText || rainChanceMax >= 55,
      description,
    };
  } catch {
    return null;
  }
}
