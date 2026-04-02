import { z } from 'zod';
import { createTaskForUser, deleteTasksForUser, listTasksForUser } from '@/lib/assistant/repository';
import type { AssistantTool, ToolExecutionInput } from '@/lib/tools/types';

const createTaskSchema = z.object({
  title: z.string().min(1).max(220),
  description: z.string().max(1200).optional(),
  dueAt: z.string().datetime().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
});

export const createTaskTool: AssistantTool = {
  name: 'tasks.create',
  label: 'Yeni görev oluştur',
  description: 'Kullanıcı adına yeni görev oluşturur.',
  requiresConfirmation: true,
  async preview(input: ToolExecutionInput) {
    const fallbackTitle =
      typeof input.params.message === 'string' && input.params.message.trim().length > 1
        ? input.params.message.trim().slice(0, 80)
        : 'Yeni görev';

    const parsed = createTaskSchema.parse({
      title: String(input.params.title ?? fallbackTitle),
      description: typeof input.params.description === 'string' ? input.params.description : undefined,
      dueAt: typeof input.params.dueAt === 'string' ? input.params.dueAt : undefined,
      priority: typeof input.params.priority === 'string' ? input.params.priority.toUpperCase() : undefined,
    });

    return {
      summary: 'Görev kaydı hazırlanıyor. Onay sonrası veritabanına yazılacak.',
      preview: {
        title: parsed.title,
        description: parsed.description ?? null,
        dueAt: parsed.dueAt ?? null,
        priority: parsed.priority ?? 'MEDIUM',
      },
      requiresConfirmation: true,
    };
  },
  async run(input: ToolExecutionInput) {
    const fallbackTitle =
      typeof input.params.message === 'string' && input.params.message.trim().length > 1
        ? input.params.message.trim().slice(0, 80)
        : 'Yeni görev';

    const parsed = createTaskSchema.parse({
      title: String(input.params.title ?? fallbackTitle),
      description: typeof input.params.description === 'string' ? input.params.description : undefined,
      dueAt: typeof input.params.dueAt === 'string' ? input.params.dueAt : undefined,
      priority: typeof input.params.priority === 'string' ? input.params.priority.toUpperCase() : undefined,
    });

    const created = await createTaskForUser(input.context.user, {
      title: parsed.title,
      description: parsed.description,
      dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null,
      priority: parsed.priority,
    });

    return {
      summary: `"${created.title}" görevi oluşturuldu.`,
      output: {
        task: created,
        undo: {
          toolName: 'tasks.undo_bulk',
          params: {
            taskIds: [created.id],
          },
          label: 'Görevi geri al',
          expiresInSec: 20,
        },
      },
    };
  },
};

export const listOverdueTasksTool: AssistantTool = {
  name: 'tasks.overdue',
  label: 'Geciken işleri listele',
  description: 'Vadesi geçen açık görevleri listeler.',
  requiresConfirmation: false,
  async preview(input: ToolExecutionInput) {
    const tasks = await listTasksForUser(input.context.user);
    const now = input.context.now.getTime();
    const overdue = tasks.filter((task) => {
      if (!task.dueAt) return false;
      const due = Date.parse(task.dueAt);
      if (!Number.isFinite(due)) return false;
      return due < now && task.status !== 'DONE';
    });

    return {
      summary: `${overdue.length} geciken görev bulundu.`,
      preview: { overdue },
      requiresConfirmation: false,
    };
  },
  async run(input: ToolExecutionInput) {
    const preview = await this.preview(input);
    return {
      summary: preview.summary,
      output: preview.preview,
    };
  },
};

export const listTodayTasksTool: AssistantTool = {
  name: 'tasks.today',
  label: 'Bugünkü görevleri listele',
  description: 'Bugün için planlanan görevleri listeler.',
  requiresConfirmation: false,
  async preview(input: ToolExecutionInput) {
    const tasks = await listTasksForUser(input.context.user);
    const dayStart = new Date(input.context.now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const today = tasks.filter((task) => {
      if (!task.dueAt) return false;
      const due = Date.parse(task.dueAt);
      return Number.isFinite(due) && due >= dayStart.getTime() && due < dayEnd.getTime();
    });

    return {
      summary: `${today.length} görev bugün için planlı.`,
      preview: { tasks: today },
      requiresConfirmation: false,
    };
  },
  async run(input: ToolExecutionInput) {
    const preview = await this.preview(input);
    return {
      summary: preview.summary,
      output: preview.preview,
    };
  },
};

const undoBulkSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(20),
});

export const undoBulkTasksTool: AssistantTool = {
  name: 'tasks.undo_bulk',
  label: 'Görev işlemini geri al',
  description: 'Asistanın oluşturduğu görevleri geri alır.',
  requiresConfirmation: false,
  async preview(input: ToolExecutionInput) {
    const parsed = undoBulkSchema.parse({
      taskIds: Array.isArray(input.params.taskIds) ? input.params.taskIds : [],
    });
    return {
      summary: `${parsed.taskIds.length} görev geri alınmaya hazırlanıyor.`,
      preview: {
        taskIds: parsed.taskIds,
      },
      requiresConfirmation: false,
    };
  },
  async run(input: ToolExecutionInput) {
    const parsed = undoBulkSchema.parse({
      taskIds: Array.isArray(input.params.taskIds) ? input.params.taskIds : [],
    });
    const deletedCount = await deleteTasksForUser(input.context.user, parsed.taskIds);
    return {
      summary: `${deletedCount} görev geri alındı.`,
      output: {
        deletedCount,
      },
    };
  },
};
