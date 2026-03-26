import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@lexoffice/db";
import { AuditService } from "../audit/audit-service";
import { MailThreadService } from "./mail-thread-service";

describe("MailThreadService", () => {
  it("draftId verildiğinde mevcut taslağı günceller", async () => {
    const draftUpdate = vi.fn().mockResolvedValue({
      id: "draft-1",
      tenantId: "cmf9s25x70000a9k0demo1234",
      mailboxId: "cmf9s25x70000a9k0mailbx01",
      createdByUserId: "cmf9s25x70000a9k0user0001"
    });

    const prisma = {
      draft: {
        findFirst: vi.fn().mockResolvedValue({ id: "draft-1" }),
        update: draftUpdate
      }
    } as unknown as PrismaClient;

    const auditService = {
      log: vi.fn().mockResolvedValue(undefined)
    } as unknown as AuditService;

    const service = new MailThreadService(prisma, auditService);

    const result = await service.createOrAutosaveDraft("cmf9s25x70000a9k0user0001", {
      draftId: "cmf9s25x70000a9k0draft001",
      tenantId: "cmf9s25x70000a9k0demo1234",
      mailboxId: "cmf9s25x70000a9k0mailbx01",
      subject: "Test Taslak",
      bodyText: "Taslak gövdesi",
      toRecipients: ["alici@example.com"]
    });

    expect(result.id).toBe("draft-1");
    expect(draftUpdate).toHaveBeenCalledTimes(1);
  });

  it("thread'i matter ile ilişkilendirir", async () => {
    const tx = {
      mailThread: {
        update: vi.fn().mockResolvedValue(undefined)
      },
      matterMessage: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined)
      }
    };

    const prisma = {
      mailThread: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cmf9s25x70000a9k0thread01",
          linkedMatterId: null
        })
      },
      matter: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cmf9s25x70000a9k0matter01",
          clientId: "cmf9s25x70000a9k0client01",
          title: "Sözleşme Uyuşmazlığı",
          referenceNo: "2026/12"
        })
      },
      $transaction: vi.fn().mockImplementation(async (callback: (trx: typeof tx) => Promise<void>) => callback(tx))
    } as unknown as PrismaClient;

    const auditService = {
      log: vi.fn().mockResolvedValue(undefined)
    } as unknown as AuditService;

    const service = new MailThreadService(prisma, auditService);

    const result = await service.linkThreadToMatter("cmf9s25x70000a9k0user0001", {
      tenantId: "cmf9s25x70000a9k0demo1234",
      threadId: "cmf9s25x70000a9k0thread01",
      matterId: "cmf9s25x70000a9k0matter01"
    });

    expect(result.matterId).toBe("cmf9s25x70000a9k0matter01");
    expect(tx.mailThread.update).toHaveBeenCalledTimes(1);
    expect(tx.matterMessage.create).toHaveBeenCalledTimes(1);
  });

  it("mail gönderimini kaydeder ve lokal provider id üretir", async () => {
    const tx = {
      mailMessage: {
        create: vi.fn().mockResolvedValue({ id: "cmf9s25x70000a9k0msg0001" })
      },
      mailRecipient: {
        createMany: vi.fn().mockResolvedValue(undefined)
      },
      mailThread: {
        update: vi.fn().mockResolvedValue(undefined)
      }
    };

    const prisma = {
      mailbox: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cmf9s25x70000a9k0mailbx01",
          email: "owner@demo.lexoffice.ai",
          senderIdentityEmail: null,
          senderIdentityName: null,
          displayName: "Demo Owner",
          provider: "MANAGED",
          connections: []
        })
      },
      mailThread: {
        create: vi.fn().mockResolvedValue({
          id: "cmf9s25x70000a9k0thread-new"
        })
      },
      $transaction: vi.fn().mockImplementation(async (callback: (trx: typeof tx) => Promise<{ id: string }>) => callback(tx))
    } as unknown as PrismaClient;

    const auditService = {
      log: vi.fn().mockResolvedValue(undefined)
    } as unknown as AuditService;

    const service = new MailThreadService(prisma, auditService);

    const result = await service.sendMessage("cmf9s25x70000a9k0user0001", {
      tenantId: "cmf9s25x70000a9k0demo1234",
      mailboxId: "cmf9s25x70000a9k0mailbx01",
      subject: "Gönderim Testi",
      bodyText: "Merhaba",
      toRecipients: ["alici@example.com"]
    });

    expect(result.messageId).toBe("cmf9s25x70000a9k0msg0001");
    expect(result.threadId).toBe("cmf9s25x70000a9k0thread-new");
    expect(result.providerMessageId.startsWith("local-")).toBe(true);
    expect(tx.mailRecipient.createMany).toHaveBeenCalledTimes(1);
  });

  it("state güncellemesinde thread içindeki tüm mesajları senkronlar", async () => {
    const tx = {
      mailMessage: {
        updateMany: vi.fn().mockResolvedValue({ count: 3 }),
        count: vi.fn().mockResolvedValue(1)
      },
      mailThread: {
        update: vi.fn().mockResolvedValue(undefined)
      }
    };

    const prisma = {
      mailMessage: {
        findFirst: vi.fn().mockResolvedValue({
          id: "cmf9s25x70000a9k0msg0001",
          threadId: "cmf9s25x70000a9k0thread01",
          state: "RECEIVED"
        })
      },
      $transaction: vi.fn().mockImplementation(
        async (callback: (trx: typeof tx) => Promise<[{ count: number }, number]>) => callback(tx)
      )
    } as unknown as PrismaClient;

    const auditService = {
      log: vi.fn().mockResolvedValue(undefined)
    } as unknown as AuditService;

    const service = new MailThreadService(prisma, auditService);

    const result = await service.updateMessageState("cmf9s25x70000a9k0user0001", {
      tenantId: "cmf9s25x70000a9k0demo1234",
      messageId: "cmf9s25x70000a9k0msg0001",
      state: "ARCHIVED"
    });

    expect(tx.mailMessage.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: "cmf9s25x70000a9k0demo1234",
        threadId: "cmf9s25x70000a9k0thread01",
        deletedAt: null
      },
      data: {
        state: "ARCHIVED"
      }
    });
    expect(result.affectedMessageCount).toBe(3);
    expect(result.state).toBe("ARCHIVED");
  });

  it("liste görünümünde temsil mesajını aktif filtreye göre seçer", async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    const prisma = {
      mailThread: {
        findMany
      }
    } as unknown as PrismaClient;

    const auditService = {
      log: vi.fn().mockResolvedValue(undefined)
    } as unknown as AuditService;

    const service = new MailThreadService(prisma, auditService);

    await service.listThreads({
      tenantId: "cmf9s25x70000a9k0demo1234",
      view: "unread",
      readStatus: "all",
      withAttachments: false,
      onlyStarred: false,
      sortBy: "date",
      sortDirection: "desc",
      limit: 25
    });

    const args = findMany.mock.calls[0]?.[0] as {
      include: {
        messages: {
          where: {
            isRead?: boolean;
          };
        };
      };
    };

    expect(args.include.messages.where.isRead).toBe(false);
  });
});
