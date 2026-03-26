import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@lexoffice/db";
import { AuditService } from "../audit/audit-service";
import { AIService } from "./ai-service";

describe("AIService", () => {
  it("mail aksiyonunda structured output döner ve kullanım kaydı üretir", async () => {
    const usageCreate = vi.fn().mockResolvedValue(undefined);
    const messageCreate = vi.fn().mockResolvedValue({
      id: "cmf9s25x70000a9k0aimsg001"
    });

    const prisma = {
      tenantSettings: {
        findUnique: vi.fn().mockResolvedValue({
          tenantId: "cmf9s25x70000a9k0demo1234",
          aiEnabled: true,
          aiHumanApprovalRequired: true
        })
      },
      mailThread: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cmf9s25x70000a9k0thread01",
          mailboxId: "cmf9s25x70000a9k0mailbx01",
          subject: "Dava dosyası hakkında",
          messages: [
            {
              id: "cmf9s25x70000a9k0msg0001",
              bodyText: "Müvekkilin ek belge talebi var.",
              snippet: "Belge talebi",
              receivedAt: new Date().toISOString(),
              sentAt: null
            }
          ]
        })
      },
      aIConversation: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cmf9s25x70000a9k0aiconv01"
        }),
        upsert: vi.fn().mockResolvedValue({
          id: "cmf9s25x70000a9k0aiconv01"
        })
      },
      aIMessage: {
        create: messageCreate
      },
      usageRecord: {
        create: usageCreate
      }
    } as unknown as PrismaClient;

    const auditService = {
      log: vi.fn().mockResolvedValue(undefined)
    } as unknown as AuditService;

    const service = new AIService(prisma, auditService);

    const result = await service.runMailAction("cmf9s25x70000a9k0user0001", {
      tenantId: "cmf9s25x70000a9k0demo1234",
      threadId: "cmf9s25x70000a9k0thread01",
      action: "MAIL_SUMMARY",
      preferredLanguage: "tr",
      stream: false
    });

    expect(result.aiMessageId).toBe("cmf9s25x70000a9k0aimsg001");
    expect(result.structuredOutput.type).toBe("summary");
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(messageCreate).toHaveBeenCalledTimes(1);
    expect(usageCreate).toHaveBeenCalledTimes(1);
  });

  it("tenant bazlı AI stats döner", async () => {
    const count = vi
      .fn()
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);

    const aggregate = vi.fn().mockResolvedValue({
      _sum: {
        inputTokens: 120,
        outputTokens: 80
      }
    });

    const groupBy = vi.fn().mockResolvedValue([
      {
        promptTemplateKey: "MAIL_SUMMARY",
        _count: { _all: 5 },
        _sum: { inputTokens: 50, outputTokens: 20 }
      },
      {
        promptTemplateKey: "MAIL_REPLY_SHORT",
        _count: { _all: 3 },
        _sum: { inputTokens: 30, outputTokens: 18 }
      },
      {
        promptTemplateKey: "UNKNOWN_ACTION",
        _count: { _all: 2 },
        _sum: { inputTokens: 40, outputTokens: 42 }
      }
    ]);

    const prisma = {
      aIMessage: {
        count,
        aggregate,
        groupBy
      }
    } as unknown as PrismaClient;

    const auditService = {
      log: vi.fn().mockResolvedValue(undefined)
    } as unknown as AuditService;

    const service = new AIService(prisma, auditService);

    const stats = await service.getSuggestionStats("cmf9s25x70000a9k0user0001", {
      tenantId: "cmf9s25x70000a9k0demo1234"
    });

    expect(stats.totals.suggestions).toBe(10);
    expect(stats.totals.accepted).toBe(6);
    expect(stats.totals.rejected).toBe(2);
    expect(stats.totals.pendingFeedback).toBe(2);
    expect(stats.totals.acceptanceRate).toBeCloseTo(0.75);
    expect(stats.tokenUsage.totalTokens).toBe(200);
    expect(stats.byAction).toHaveLength(2);
    expect(stats.byAction[0]?.action).toBe("MAIL_SUMMARY");
  });

  it("streamSuggestion metni chunk'lara böler", async () => {
    const prisma = {} as PrismaClient;
    const auditService = {
      log: vi.fn().mockResolvedValue(undefined)
    } as unknown as AuditService;

    const service = new AIService(prisma, auditService);
    const chunks: string[] = [];

    for await (const chunk of service.streamSuggestion("abcdefghi", 3)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["abc", "def", "ghi"]);
  });
});
