import { listTasksForUser } from '@/lib/assistant/repository';
import { createAdminClient } from '@/utils/supabase/admin';
import type { AssistantTool, ToolExecutionInput } from '@/lib/tools/types';

const demoCalendar = [
  {
    title: '09:30 Müvekkil görüşmesi',
    type: 'meeting',
  },
  {
    title: '14:00 Duruşma hazırlık kontrolü',
    type: 'focus',
  },
];

async function loadCalendarItems(userId: string) {
  const admin = createAdminClient();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const result = await admin
    .from('office_tasks')
    .select('id,title,due_at,priority,status')
    .eq('assigned_to', userId)
    .gte('due_at', dayStart.toISOString())
    .lt('due_at', dayEnd.toISOString())
    .order('due_at', { ascending: true })
    .limit(12);

  if (result.error || !result.data || result.data.length === 0) {
    return {
      source: 'demo' as const,
      calendar: demoCalendar,
    };
  }

  return {
    source: 'workspace' as const,
    calendar: result.data.map((item) => ({
      title:
        typeof item.due_at === 'string'
          ? `${new Date(item.due_at).toLocaleTimeString('tr-TR', {
              hour: '2-digit',
              minute: '2-digit',
            })} ${item.title}`
          : item.title,
      type: item.priority === 'high' ? 'critical' : 'focus',
      status: item.status,
    })),
  };
}

export const officeSummaryTool: AssistantTool = {
  name: 'office.summary',
  label: 'Bugünü özetle',
  description: 'Günlük takvim ve görev görünümünü tek yerde özetler.',
  requiresConfirmation: false,
  async preview(input: ToolExecutionInput) {
    const tasks = await listTasksForUser(input.context.user);
    const calendarData = await loadCalendarItems(input.context.user.id);
    const openTasks = tasks.filter((task) => task.status !== 'DONE');
    const urgent = openTasks.filter((task) => task.priority === 'URGENT' || task.priority === 'HIGH');

    return {
      summary: `Açık ${openTasks.length} görev, kritik ${urgent.length} iş var.${calendarData.source === 'workspace' ? '' : ' (Takvim demo)'}`,
      preview: {
        calendar: calendarData.calendar,
        openTasks: openTasks.slice(0, 8),
        urgent: urgent.slice(0, 5),
        source: calendarData.source,
      },
      requiresConfirmation: false,
    };
  },
  async run(input: ToolExecutionInput) {
    const preview = await this.preview(input);
    return {
      summary: 'Gün özeti hazırlandı.',
      output: preview.preview,
    };
  },
};
