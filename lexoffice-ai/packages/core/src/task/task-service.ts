import type { PrismaClient } from "@lexoffice/db";
import {
  createTaskSchema,
  listTasksSchema,
  updateTaskStatusSchema,
  type CreateTaskInput,
  type ListTasksInput,
  type UpdateTaskStatusInput
} from "@lexoffice/contracts";
import { AuditService } from "../audit/audit-service";
import { NotFoundError } from "../errors/app-error";

export class TaskService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {}

  async listTasks(payload: ListTasksInput) {
    const input = listTasksSchema.parse(payload);

    return this.prisma.task.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        ...(input.matterId ? { matterId: input.matterId } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.assignedToId ? { assignedToId: input.assignedToId } : {})
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: input.limit
    });
  }

  async createTask(actorUserId: string, payload: CreateTaskInput) {
    const input = createTaskSchema.parse(payload);

    if (input.matterId) {
      const matter = await this.prisma.matter.findFirst({
        where: {
          id: input.matterId,
          tenantId: input.tenantId,
          deletedAt: null
        },
        select: { id: true }
      });

      if (!matter) {
        throw new NotFoundError("Task oluşturmak için matter bulunamadı");
      }
    }

    const task = await this.prisma.task.create({
      data: {
        tenantId: input.tenantId,
        matterId: input.matterId ?? null,
        title: input.title,
        description: input.description ?? null,
        status: "TODO",
        priority: input.priority,
        dueAt: input.dueAt ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        createdById: actorUserId
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "task.created",
      resourceType: "task",
      resourceId: task.id,
      metadata: {
        matterId: task.matterId,
        priority: task.priority,
        dueAt: task.dueAt
      }
    });

    return task;
  }

  async updateTaskStatus(actorUserId: string, payload: UpdateTaskStatusInput) {
    const input = updateTaskStatusSchema.parse(payload);

    const existingTask = await this.prisma.task.findFirst({
      where: {
        id: input.taskId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      select: {
        id: true,
        status: true
      }
    });

    if (!existingTask) {
      throw new NotFoundError("Güncellenecek task bulunamadı");
    }

    const updated = await this.prisma.task.update({
      where: {
        id: existingTask.id
      },
      data: {
        status: input.status,
        completedAt: input.status === "COMPLETED" ? new Date() : null
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "task.status.updated",
      resourceType: "task",
      resourceId: updated.id,
      metadata: {
        previousStatus: existingTask.status,
        currentStatus: updated.status
      }
    });

    return updated;
  }
}
