import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@lexoffice/db";
import {
  aiStatsQuerySchema,
  aiStatsResponseSchema,
  aiSuggestionFeedbackSchema,
  runAiMailActionResponseSchema,
  runAiMailActionSchema,
  type AIActionType,
  type AIStructuredOutput,
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
    const context =
      input.action === "MAIL_SUMMARY"
        ? buildThreadContext(thread.subject, thread.messages)
        : buildMailContext(thread.subject, selectedMessage.bodyText ?? selectedMessage.snippet ?? "");
    const structuredOutput = this.buildStructuredOutput(
      input.action,
      input.preferredLanguage,
      context
    );
    const suggestion = this.renderSuggestion(structuredOutput, input.preferredLanguage);
    const inputTokens = estimateTokenCount(actionPrompt + context);
    const outputTokens = estimateTokenCount(suggestion);

    const conversationId = await this.resolveOrCreateConversationId(
      input.tenantId,
      actorUserId,
      input.threadId
    );

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
          humanApprovalRequired: tenantSettings.aiHumanApprovalRequired,
          structuredOutput
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

    return runAiMailActionResponseSchema.parse({
      aiMessageId: aiMessage.id,
      action: input.action,
      suggestion,
      structuredOutput,
      humanApprovalRequired: tenantSettings.aiHumanApprovalRequired,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      }
    });
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

  async getSuggestionStats(actorUserId: string, payload: unknown) {
    const input = aiStatsQuerySchema.parse(payload);
    const monthStart = startOfMonth();
    const monthEnd = endOfMonth();

    const whereAllTime = {
      tenantId: input.tenantId,
      role: "ASSISTANT" as const,
      promptTemplateKey: { not: null }
    };

    const whereMonth = {
      ...whereAllTime,
      createdAt: {
        gte: monthStart,
        lte: monthEnd
      }
    };

    const [
      totalSuggestions,
      totalAccepted,
      totalRejected,
      monthSuggestions,
      monthAccepted,
      monthRejected,
      tokenAggregate,
      groupedByAction
    ] = await Promise.all([
      this.prisma.aIMessage.count({
        where: whereAllTime
      }),
      this.prisma.aIMessage.count({
        where: {
          ...whereAllTime,
          accepted: true
        }
      }),
      this.prisma.aIMessage.count({
        where: {
          ...whereAllTime,
          accepted: false
        }
      }),
      this.prisma.aIMessage.count({
        where: whereMonth
      }),
      this.prisma.aIMessage.count({
        where: {
          ...whereMonth,
          accepted: true
        }
      }),
      this.prisma.aIMessage.count({
        where: {
          ...whereMonth,
          accepted: false
        }
      }),
      this.prisma.aIMessage.aggregate({
        where: whereAllTime,
        _sum: {
          inputTokens: true,
          outputTokens: true
        }
      }),
      this.prisma.aIMessage.groupBy({
        by: ["promptTemplateKey"],
        where: whereAllTime,
        _count: {
          _all: true
        },
        _sum: {
          inputTokens: true,
          outputTokens: true
        }
      })
    ]);

    const inputTokens = tokenAggregate._sum.inputTokens ?? 0;
    const outputTokens = tokenAggregate._sum.outputTokens ?? 0;

    const byAction = groupedByAction.flatMap((row) => {
      const actionKey = row.promptTemplateKey;
      if (!actionKey || !isAIActionType(actionKey)) {
        return [];
      }

      const actionInputTokens = row._sum.inputTokens ?? 0;
      const actionOutputTokens = row._sum.outputTokens ?? 0;

      return [
        {
          action: actionKey,
          suggestions: row._count._all,
          inputTokens: actionInputTokens,
          outputTokens: actionOutputTokens,
          totalTokens: actionInputTokens + actionOutputTokens
        }
      ];
    });

    await this.auditService.log({
      tenantId: input.tenantId,
      actorUserId,
      action: "ai.stats.viewed",
      resourceType: "tenant",
      resourceId: input.tenantId
    });

    return aiStatsResponseSchema.parse({
      tenantId: input.tenantId,
      asOf: new Date().toISOString(),
      totals: buildStatsBucket(totalSuggestions, totalAccepted, totalRejected),
      currentMonth: buildStatsBucket(monthSuggestions, monthAccepted, monthRejected),
      tokenUsage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens
      },
      byAction
    });
  }

  async *streamSuggestion(suggestion: string, chunkSize = 140): AsyncGenerator<string, void, void> {
    const content = suggestion.trim();
    if (!content) {
      return;
    }

    const safeChunkSize = Math.max(1, chunkSize);
    for (let start = 0; start < content.length; start += safeChunkSize) {
      const chunk = content.slice(start, start + safeChunkSize);
      if (chunk.length > 0) {
        yield chunk;
      }
    }
  }

  private async resolveOrCreateConversationId(
    tenantId: string,
    actorUserId: string,
    threadId: string
  ): Promise<string> {
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

  private buildStructuredOutput(
    action: AIActionType,
    language: "tr" | "en",
    context: string
  ): AIStructuredOutput {
    if (action === "MAIL_SUMMARY") {
      return {
        type: "summary",
        bullets:
          language === "tr"
            ? [
                `Konu: ${context.slice(0, 80)}`,
                "Talep: Müvekkilden geri dönüş bekleniyor.",
                "Öncelik: Süre takibi gereken bir yazışma.",
                "Not: Cevap gönderilmeden önce ek belge kontrolü önerilir."
              ]
            : [
                `Topic: ${context.slice(0, 80)}`,
                "Request: Awaiting client feedback.",
                "Priority: Deadline-sensitive correspondence.",
                "Note: Review supporting documents before reply."
              ],
        riskLevel: "MEDIUM",
        nextStep:
          language === "tr"
            ? "24 saat içinde ilk dönüş taslağı hazırlanmalı."
            : "Prepare a first response draft within 24 hours."
      };
    }

    if (
      action === "MAIL_REPLY_PROFESSIONAL" ||
      action === "MAIL_REPLY_SHORT" ||
      action === "MAIL_REPLY_FORMAL"
    ) {
      const tone =
        action === "MAIL_REPLY_SHORT"
          ? "short"
          : action === "MAIL_REPLY_FORMAL"
            ? "formal"
            : "professional";
      return {
        type: "reply",
        tone,
        subjectSuggestion:
          language === "tr" ? "Konu Hakkında Geri Dönüş" : "Follow-up on Your Message",
        body:
          tone === "short"
            ? language === "tr"
              ? "Mesajınız alınmıştır. Konuyu değerlendirip kısa süre içinde dönüş sağlayacağız."
              : "We received your message. We will review it and get back shortly."
            : tone === "formal"
              ? language === "tr"
                ? "Sayın ilgili,\nMesajınız tarafımızca incelenmiştir. Gerekli değerlendirmeler tamamlandıktan sonra resmi geri dönüş tarafınıza iletilecektir.\nSaygılarımızla."
                : "Dear Sir/Madam,\nYour message has been reviewed. A formal response will be shared once our assessment is completed.\nSincerely."
              : language === "tr"
                ? "Sayın ilgili,\nMesajınız için teşekkür ederiz. Konu hukuk ekibimiz tarafından değerlendirilmekte olup en kısa sürede detaylı geri dönüş sağlanacaktır."
                : "Thank you for your message. Our legal team is reviewing the matter and will provide a detailed response shortly."
      };
    }

    if (action === "THREAD_TASK_EXTRACTION" || action === "THREAD_ACTION_LIST") {
      return {
        type: "tasks",
        tasks:
          language === "tr"
            ? [
                {
                  title: "Müvekkilden ek belge talep et",
                  ownerSuggestion: "Sekreter",
                  dueDateSuggestion: "Bugün +1 gün"
                },
                {
                  title: "Duruşma tarihini ofis takvimine işle",
                  ownerSuggestion: "Ofis yöneticisi",
                  dueDateSuggestion: "Bugün +1 gün"
                },
                {
                  title: "Partner review için yanıt taslağı hazırla",
                  ownerSuggestion: "Sorumlu avukat",
                  dueDateSuggestion: "Bugün +2 gün"
                }
              ]
            : [
                {
                  title: "Request additional documents from client",
                  ownerSuggestion: "Secretary",
                  dueDateSuggestion: "Today +1 day"
                },
                {
                  title: "Add hearing date to office calendar",
                  ownerSuggestion: "Office manager",
                  dueDateSuggestion: "Today +1 day"
                },
                {
                  title: "Prepare reply draft for partner review",
                  ownerSuggestion: "Assigned lawyer",
                  dueDateSuggestion: "Today +2 days"
                }
              ]
      };
    }

    if (action === "THREAD_MATTER_SUMMARY") {
      return {
        type: "matter_summary",
        topic: language === "tr" ? "Mail yazışması özeti" : "Email thread summary",
        riskSummary:
          language === "tr"
            ? "Süre takibi yapılmazsa gecikme riski oluşabilir."
            : "Delay risk may materialize without deadline follow-up.",
        nextSteps:
          language === "tr"
            ? [
                "Dosya notunu güncelle",
                "Müvekkile ara bilgilendirme geç",
                "İç review toplantısı planla"
              ]
            : ["Update matter notes", "Send interim client update", "Plan internal review meeting"]
      };
    }

    const sensitiveSignals = detectSensitiveSignals(context);
    return {
      type: "sensitive_check",
      containsSensitiveData: sensitiveSignals.length > 0,
      categories: sensitiveSignals,
      recommendation:
        language === "tr"
          ? sensitiveSignals.length > 0
            ? "Gönderimden önce redaksiyon veya şifreli paylaşım kanalı kullanın."
            : "Hassas veri sinyali düşük; standart kontrol sonrası paylaşılabilir."
          : sensitiveSignals.length > 0
            ? "Use redaction or encrypted channel before sending."
            : "Sensitive data signal is low; share after standard review."
    };
  }

  private renderSuggestion(output: AIStructuredOutput, language: "tr" | "en"): string {
    if (output.type === "summary") {
      const header = language === "tr" ? "Özet:" : "Summary:";
      const bullets = output.bullets.map((bullet) => `- ${bullet}`).join("\n");
      const riskLabel = language === "tr" ? "Risk" : "Risk";
      const nextLabel = language === "tr" ? "Sonraki adım" : "Next step";
      return `${header}\n${bullets}\n- ${riskLabel}: ${output.riskLevel}\n- ${nextLabel}: ${output.nextStep}`;
    }

    if (output.type === "reply") {
      return output.body;
    }

    if (output.type === "tasks") {
      return output.tasks.map((task, index) => `${index + 1}) ${task.title}`).join("\n");
    }

    if (output.type === "matter_summary") {
      const nextSteps = output.nextSteps.map((step) => `- ${step}`).join("\n");
      if (language === "tr") {
        return `Matter Özeti:\n- Konu: ${output.topic}\n- Risk: ${output.riskSummary}\n- Sonraki adımlar:\n${nextSteps}`;
      }
      return `Matter Summary:\n- Topic: ${output.topic}\n- Risk: ${output.riskSummary}\n- Next steps:\n${nextSteps}`;
    }

    if (output.containsSensitiveData) {
      if (language === "tr") {
        return `Hassas veri analizi: ${output.categories.join(", ")} sinyalleri tespit edildi. ${output.recommendation}`;
      }
      return `Sensitive data analysis: signals detected for ${output.categories.join(", ")}. ${output.recommendation}`;
    }

    return language === "tr"
      ? `Hassas veri analizi: belirgin bir sinyal tespit edilmedi. ${output.recommendation}`
      : `Sensitive data analysis: no explicit signal detected. ${output.recommendation}`;
  }
}

function buildMailContext(subject: string | null, body: string): string {
  const safeSubject = subject ?? "(Konu yok)";
  return `Konu: ${safeSubject}\nİçerik: ${body.slice(0, 6000)}`;
}

function buildThreadContext(
  subject: string | null,
  messages: Array<{
    fromName: string | null;
    fromEmail: string | null;
    sentAt: Date | null;
    receivedAt: Date | null;
    bodyText: string | null;
    snippet: string | null;
  }>
): string {
  const safeSubject = subject ?? "(Konu yok)";
  const selected = messages.slice(-12);
  const segments = selected.map((message, index) => {
    const author = message.fromName ?? message.fromEmail ?? "Bilinmeyen Gönderen";
    const dateValue = message.sentAt ?? message.receivedAt;
    const dateLabel = dateValue ? new Date(dateValue).toISOString() : "tarih_yok";
    const content = (message.bodyText ?? message.snippet ?? "").replace(/\s+/g, " ").trim();
    const excerpt = content.slice(0, 500);
    return `Mesaj ${index + 1} | ${author} | ${dateLabel}: ${excerpt}`;
  });

  return `Konu: ${safeSubject}\nKonuşma Akışı:\n${segments.join("\n")}`.slice(0, 7000);
}

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function buildStatsBucket(suggestions: number, accepted: number, rejected: number) {
  const pendingFeedback = Math.max(suggestions - accepted - rejected, 0);
  const reviewed = accepted + rejected;

  return {
    suggestions,
    accepted,
    rejected,
    pendingFeedback,
    acceptanceRate: reviewed === 0 ? 0 : accepted / reviewed
  };
}

function isAIActionType(value: string): value is AIActionType {
  return Object.prototype.hasOwnProperty.call(PROMPT_REGISTRY, value);
}

function detectSensitiveSignals(context: string): string[] {
  const normalized = context.toLowerCase();
  const categories = new Set<string>();

  if (/\b\d{11}\b/.test(context) || normalized.includes("tc kimlik")) {
    categories.add("identity_number");
  }

  if (/tr\d{2}[0-9a-z]{5,}/i.test(context) || normalized.includes("iban")) {
    categories.add("iban_or_bank_account");
  }

  if (
    normalized.includes("gizli") ||
    normalized.includes("privileged") ||
    normalized.includes("confidential")
  ) {
    categories.add("legal_confidential");
  }

  return [...categories];
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
