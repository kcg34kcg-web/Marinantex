import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@lexoffice/db";
import {
  aiSuggestionFeedbackSchema,
  runAiMailActionSchema,
  type RunAiMailActionInput
} from "@lexoffice/contracts";
import { ForbiddenError, NotFoundError } from "../errors/app-error";
import { AuditService } from "../audit/audit-service";
import { PROMPT_REGISTRY } from "./prompt-registry";

export class AIService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auditService: AuditService
  ) {}

  async runMailAction(actorUserId: string, payload: RunAiMailActionInput) {
    const input = runAiMailActionSchema.parse(payload);

    const tenantSettings = await this.prisma.tenantSettings.findUnique({
      where: { tenantId: input.tenantId }
    });

    if (!tenantSettings?.aiEnabled) {
      throw new ForbiddenError("Bu tenant için AI kullanımı kapalı");
    }

    const thread = await this.prisma.mailThread.findFirst({
      where: {
        id: input.threadId,
        tenantId: input.tenantId,
        deletedAt: null
      },
      include: {
        messages: {
          where: { deletedAt: null },
          orderBy: [{ receivedAt: "asc" }, { sentAt: "asc" }]
        }
      }
    });

    if (!thread) {
      throw new NotFoundError("AI işleminde thread bulunamadı");
    }

    const selectedMessage =
      input.messageId !== undefined
        ? thread.messages.find((message) => message.id === input.messageId)
        : thread.messages[thread.messages.length - 1];

    if (!selectedMessage) {
      throw new NotFoundError("AI işleminde mesaj bulunamadı");
    }

    const actionPrompt =
      PROMPT_REGISTRY[input.action][input.preferredLanguage] ?? PROMPT_REGISTRY[input.action].tr;
    const context = buildMailContext(thread.subject, selectedMessage.bodyText ?? selectedMessage.snippet ?? "");

    const suggestion = this.generateSuggestion(input.action, input.preferredLanguage, context);
    const inputTokens = estimateTokenCount(actionPrompt + context);
    const outputTokens = estimateTokenCount(suggestion);

    const conversationId = await this.resolveOrCreateConversationId(input.tenantId, actorUserId, input.threadId);

    const conversation = await this.prisma.aIConversation.upsert({
      where: {
        id: conversationId
      },
      update: {
        title: thread.subject ?? "Mail AI Workspace",
        metadata: {
          threadId: thread.id,
          mailboxId: thread.mailboxId
        }
      },
      create: {
        id: conversationId,
        tenantId: input.tenantId,
        createdById: actorUserId,
        title: thread.subject ?? "Mail AI Workspace",
        contextType: "mail_thread",
        contextId: thread.id,
        metadata: {
          threadId: thread.id,
          mailboxId: thread.mailboxId
        }
      }
    });

    const aiMessage = await this.prisma.aIMessage.create({
      data: {
        tenantId: input.tenantId,
        conversationId: conversation.id,
        userId: actorUserId,
        role: "ASSISTANT",
        content: suggestion,
        promptTemplateKey: input.action,
        modelProvider: "mock",
        modelName: "lexoffice-mock-v1",
        inputTokens,
        outputTokens,
        metadata: {
          language: input.preferredLanguage,
          sourceMessageId: selectedMessage.id,
          humanApprovalRequired: tenantSettings.aiHumanApprovalRequired
        }
      }
    });

    await this.prisma.usageRecord.create({
      data: {
        tenantId: input.tenantId,
        metric: "ai.tokens.total",
        value: inputTokens + outputTokens,
        periodStart: startOfMonth(),
        periodEnd: endOfMonth(),
        metadata: {
          action: input.action,
          model: "lexoffice-mock-v1"
        }
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "ai.mail.action.executed",
      resourceType: "ai_message",
      resourceId: aiMessage.id,
      metadata: {
        action: input.action,
        threadId: input.threadId,
        sourceMessageId: selectedMessage.id
      }
    });

    return {
      aiMessageId: aiMessage.id,
      action: input.action,
      suggestion,
      humanApprovalRequired: tenantSettings.aiHumanApprovalRequired,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    };
  }

  async setSuggestionFeedback(actorUserId: string, payload: unknown) {
    const input = aiSuggestionFeedbackSchema.parse(payload);

    const updated = await this.prisma.aIMessage.updateMany({
      where: {
        id: input.aiMessageId,
        tenantId: input.tenantId
      },
      data: {
        accepted: input.accepted
      }
    });

    if (updated.count === 0) {
      throw new NotFoundError("AI öneri kaydı bulunamadı");
    }

    await this.prisma.usageRecord.create({
      data: {
        tenantId: input.tenantId,
        metric: input.accepted ? "ai.suggestion.accepted" : "ai.suggestion.rejected",
        value: 1,
        periodStart: startOfMonth(),
        periodEnd: endOfMonth(),
        metadata: {
          aiMessageId: input.aiMessageId
        }
      }
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "ai.suggestion.feedback",
      resourceType: "ai_message",
      resourceId: input.aiMessageId,
      metadata: {
        accepted: input.accepted
      }
    });

    return { success: true };
  }

  private async resolveOrCreateConversationId(tenantId: string, actorUserId: string, threadId: string): Promise<string> {
    const existing = await this.prisma.aIConversation.findFirst({
      where: {
        tenantId,
        createdById: actorUserId,
        contextType: "mail_thread",
        contextId: threadId
      },
      select: { id: true }
    });

    return existing?.id ?? cryptoRandomId();
  }

  private generateSuggestion(action: keyof typeof PROMPT_REGISTRY, language: "tr" | "en", context: string): string {
    if (action === "MAIL_SUMMARY") {
      return language === "tr"
        ? `Özet:\n- Konu: ${context.slice(0, 80)}\n- Talep: Müvekkil geri dönüşü bekleniyor\n- Risk: Süre takibi gerekli\n- Sonraki adım: 24 saat içinde yanıt önerilir`
        : `Summary:\n- Topic: ${context.slice(0, 80)}\n- Request: Awaiting client feedback\n- Risk: Deadline tracking needed\n- Next step: reply within 24 hours`;
    }

    if (action === "THREAD_TASK_EXTRACTION" || action === "THREAD_ACTION_LIST") {
      return language === "tr"
        ? "1) Müvekkilden ek belge talep et\n2) Duruşma tarihini takvime işle\n3) Partner review için taslak hazırla"
        : "1) Request additional documents from client\n2) Add hearing date to calendar\n3) Prepare draft for partner review";
    }

    if (action === "SENSITIVE_DATA_CHECK") {
      return language === "tr"
        ? "Hassas veri analizi: Metin içinde kimlik/hesap bilgisi olabilecek ifadeler tespit edildi. Gönderim öncesi redaksiyon önerilir."
        : "Sensitive data analysis: Potential identity/account details detected. Redaction is recommended before sending.";
    }

    return language === "tr"
      ? "Sayın ilgili, mesajınız için teşekkür ederiz. Konuyu inceledik, gerekli değerlendirmeyi tamamlayıp en kısa sürede detaylı dönüş sağlayacağız."
      : "Thank you for your message. We reviewed the matter and will provide a detailed response shortly.";
  }
}

function buildMailContext(subject: string | null, body: string): string {
  const safeSubject = subject ?? "(Konu yok)";
  return `Konu: ${safeSubject}\nİçerik: ${body.slice(0, 6000)}`;
}

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
}

function endOfMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
}

function cryptoRandomId(): string {
  return `ai_${randomBytes(12).toString("hex")}`;
}
