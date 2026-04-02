import { z } from 'zod';
import { createAdminClient } from '@/utils/supabase/admin';
import { requireInternalOfficeUser } from '@/lib/office/team-access';
import { getSessionUser } from '@/lib/auth/session';
import { getAssistantPreference, listTasksForUser } from '@/lib/assistant/repository';
import {
  buildBusyCheckSignal,
  buildEndOfDaySignal,
  buildWeatherCourtSignal,
  fetchWeatherSnapshot,
  isWithinQuietHours,
} from '@/lib/assistant/proactive';

export const runtime = 'nodejs';

const querySchema = z.object({
  lastActiveAt: z.coerce.number().optional(),
  lastSignalId: z.string().max(120).optional(),
});

function isMeetingSoon(meetingIso: string, now: Date, horizonMin: number) {
  const eventTime = Date.parse(meetingIso);
  if (!Number.isFinite(eventTime)) {
    return false;
  }
  const diff = eventTime - now.getTime();
  return diff >= 0 && diff <= horizonMin * 60 * 1000;
}

type UpcomingOfficeItem = {
  title: string;
  dueAt: string;
};

const COURT_KEYWORDS = ['adliye', 'duruşma', 'durusma', 'mahkeme', 'icra', 'tebligat'];

async function listUpcomingOfficeItems(now: Date): Promise<UpcomingOfficeItem[]> {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return [];
  }

  const admin = createAdminClient();
  let visibleCaseIds: string[] | null = null;

  if (access.role === 'lawyer') {
    const caseScope = await admin.from('cases').select('id').eq('lawyer_id', access.userId);
    if (caseScope.error) {
      return [];
    }
    visibleCaseIds = (caseScope.data ?? []).map((item) => item.id);
    if (visibleCaseIds.length === 0) {
      return [];
    }
  }

  const upperBound = new Date(now.getTime() + 1000 * 60 * 90).toISOString();
  const lowerBound = now.toISOString();

  const query = admin
    .from('office_tasks')
    .select('title,due_at,status')
    .gte('due_at', lowerBound)
    .lte('due_at', upperBound)
    .in('status', ['open', 'in_progress'])
    .order('due_at', { ascending: true })
    .limit(12);

  if (visibleCaseIds) {
    query.in('case_id', visibleCaseIds);
  }

  const result = await query;
  if (result.error) {
    return [];
  }

  return (result.data ?? [])
    .filter((item) => typeof item.title === 'string' && typeof item.due_at === 'string')
    .map((item) => ({
      title: item.title as string,
      dueAt: item.due_at as string,
    }));
}

async function buildOfficeTaskStats(now: Date) {
  const access = await requireInternalOfficeUser();
  if (!access.ok) {
    return null;
  }

  const admin = createAdminClient();
  let visibleCaseIds: string[] | null = null;

  if (access.role === 'lawyer') {
    const caseScope = await admin.from('cases').select('id').eq('lawyer_id', access.userId);
    if (caseScope.error) {
      return null;
    }
    visibleCaseIds = (caseScope.data ?? []).map((item) => item.id);
    if (visibleCaseIds.length === 0) {
      return { completed: 0, open: 0, overdue: 0 };
    }
  }

  const query = admin
    .from('office_tasks')
    .select('status,due_at')
    .order('updated_at', { ascending: false })
    .limit(300);

  if (visibleCaseIds) {
    query.in('case_id', visibleCaseIds);
  }

  const result = await query;
  if (result.error) {
    return null;
  }

  const rows = result.data ?? [];
  const completed = rows.filter((item) => item.status === 'done').length;
  const open = rows.filter((item) => item.status !== 'done').length;
  const overdue = rows.filter((item) => {
    if (item.status === 'done' || !item.due_at) {
      return false;
    }
    const due = Date.parse(item.due_at);
    return Number.isFinite(due) && due < now.getTime();
  }).length;

  return { completed, open, overdue };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Oturum doğrulanamadı.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    lastActiveAt: url.searchParams.get('lastActiveAt') ?? undefined,
    lastSignalId: url.searchParams.get('lastSignalId') ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ signal: null });
  }

  const now = new Date();
  const preference = await getAssistantPreference(user);
  const isQuiet = isWithinQuietHours({
    start: preference.quietHoursStart,
    end: preference.quietHoursEnd,
    hour: now.getHours(),
  });
  const lastSignalId = parsed.data.lastSignalId;

  const upcomingItems = await listUpcomingOfficeItems(now);
  const upcomingCourtTask = upcomingItems.find((item) => {
    const normalized = item.title.toLocaleLowerCase('tr-TR');
    return COURT_KEYWORDS.some((keyword) => normalized.includes(keyword)) && isMeetingSoon(item.dueAt, now, 90);
  });
  if (upcomingCourtTask) {
    const city = process.env.ASSISTANT_WEATHER_CITY || 'Istanbul';
    const weather = await fetchWeatherSnapshot(city);
    if (weather?.isRainLikely) {
      const signal = buildWeatherCourtSignal(now, upcomingCourtTask.title, weather);
      if (signal.id !== lastSignalId) {
        return Response.json({ signal });
      }
    }
  }

  if (isQuiet) {
    return Response.json({ signal: null });
  }

  const hour = now.getHours();
  if (hour >= 18 && hour <= 20) {
    const officeStats = await buildOfficeTaskStats(now);
    let resolvedStats = officeStats;
    if (!resolvedStats) {
      const fallbackTasks = await listTasksForUser(user);
      const completed = fallbackTasks.filter((task) => task.status === 'DONE').length;
      const open = fallbackTasks.filter((task) => task.status !== 'DONE').length;
      const overdue = fallbackTasks.filter((task) => {
        if (!task.dueAt || task.status === 'DONE') return false;
        const due = Date.parse(task.dueAt);
        return Number.isFinite(due) && due < now.getTime();
      }).length;
      resolvedStats = { completed, open, overdue };
    }

    const signal = buildEndOfDaySignal(now, resolvedStats);
    if (signal.id !== lastSignalId) {
      return Response.json({ signal });
    }
  }

  const lastActiveAt = parsed.data.lastActiveAt ?? now.getTime();
  const inactiveMs = now.getTime() - lastActiveAt;
  if (preference.proactiveLevel >= 2 && inactiveMs >= 2 * 60 * 60 * 1000) {
    const signal = buildBusyCheckSignal(now);
    if (signal.id !== lastSignalId) {
      return Response.json({ signal });
    }
  }

  return Response.json({ signal: null });
}
