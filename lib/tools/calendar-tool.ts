import type { AssistantTool, ToolExecutionInput } from '@/lib/tools/types';
import { createTaskForUser } from '@/lib/assistant/repository';

const demoMeetings = [
  {
    id: 'mtg-1',
    title: 'Müvekkil Strateji Toplantısı',
    startsAt: new Date(Date.now() + 1000 * 60 * 30),
    durationMin: 45,
    attendees: ['Av. Kerim', 'Stajyer Ece'],
  },
  {
    id: 'mtg-2',
    title: 'Tahsilat ve Finans Değerlendirme',
    startsAt: new Date(Date.now() + 1000 * 60 * 180),
    durationMin: 30,
    attendees: ['Av. Kerim', 'Muhasebe'],
  },
];

export function getDemoMeetings() {
  return demoMeetings.map((item) => ({
    id: item.id,
    title: item.title,
    startsAt: item.startsAt,
    durationMin: item.durationMin,
    attendees: item.attendees,
  }));
}

function toMeetingView() {
  return demoMeetings.map((item) => ({
    id: item.id,
    title: item.title,
    startsAt: item.startsAt.toISOString(),
    durationMin: item.durationMin,
    attendees: item.attendees,
  }));
}

export const calendarTool: AssistantTool = {
  name: 'calendar.show',
  label: 'Toplantıları göster',
  description: 'Yaklaşan toplantıları listeler.',
  requiresConfirmation: false,
  async preview() {
    const meetings = toMeetingView();
    return {
      summary: `${meetings.length} toplantı bulundu.`,
      preview: { meetings },
      requiresConfirmation: false,
    };
  },
  async run() {
    const meetings = toMeetingView();
    return {
      summary: `${meetings.length} toplantı listelendi.`,
      output: { meetings },
    };
  },
};

export const calendarExtractTasksTool: AssistantTool = {
  name: 'calendar.extract_tasks',
  label: 'Toplantıdan görev çıkar',
  description: 'Toplantı notlarından görev önerileri üretir.',
  requiresConfirmation: true,
  async preview(input: ToolExecutionInput) {
    const notes = String(input.params.notes ?? '');
    const suggestions =
      notes.trim().length > 0
        ? notes
            .split(/[\n.;]/g)
            .map((line) => line.trim())
            .filter((line) => line.length > 6)
            .slice(0, 5)
            .map((line, index) => ({
              id: `task-${index + 1}`,
              title: line,
              priority: index === 0 ? 'HIGH' : 'MEDIUM',
            }))
        : [
            { id: 'task-1', title: 'Toplantı karar özetini ekiple paylaş', priority: 'HIGH' },
            { id: 'task-2', title: 'Belirlenen belge listesini tamamla', priority: 'MEDIUM' },
          ];

    return {
      summary: `${suggestions.length} görev önerisi hazırlandı. Onay sonrası görev kaydı oluşturulur.`,
      preview: {
        notesPreview: notes.slice(0, 600),
        suggestions,
      },
      requiresConfirmation: true,
    };
  },
  async run(input: ToolExecutionInput) {
    const preview = await this.preview(input);
    const suggestions = Array.isArray(preview.preview.suggestions) ? preview.preview.suggestions : [];
    const createdTasks = await Promise.all(
      suggestions.map((item) =>
        createTaskForUser(input.context.user, {
          title: typeof item.title === 'string' ? item.title : 'Toplantı görevi',
          priority: item.priority === 'HIGH' ? 'HIGH' : 'MEDIUM',
          description: 'Toplantı notlarından otomatik çıkarıldı.',
        }),
      ),
    );

    return {
      summary: `${createdTasks.length} görev toplantı notlarından oluşturuldu.`,
      output: {
        ...preview.preview,
        createdTasks,
        undo: {
          toolName: 'tasks.undo_bulk',
          params: {
            taskIds: createdTasks.map((item) => item.id),
          },
          label: 'Oluşturulan görevleri geri al',
          expiresInSec: 30,
        },
      },
    };
  },
};
