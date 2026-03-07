import { PrismaClient, PlanTier } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const permissionCodes = [
  ["mailbox.view", "Mailbox görüntüleme"],
  ["mailbox.connect", "Mailbox bağlama"],
  ["mailbox.create", "Mailbox oluşturma"],
  ["mail.send", "Mail gönderme"],
  ["mail.draft.save", "Taslak kaydetme"],
  ["mail.label.manage", "Etiket ve klasör yönetimi"],
  ["mail.ai.compose", "AI ile mail taslağı"],
  ["file.upload", "Dosya yükleme"],
  ["client.matter.access", "Müvekkil dosya erişimi"],
  ["user.invite", "Kullanıcı daveti"],
  ["billing.view", "Billing erişimi"],
  ["domain.manage", "Domain yönetimi"],
  ["audit.view", "Audit log görüntüleme"],
  ["security.manage", "Güvenlik ayarları"],
  ["admin.all", "Tam yönetim"],
  ["ai.workspace", "AI asistan kullanımı"]
] as const;

const roleMap: Record<string, string[]> = {
  super_admin: permissionCodes.map(([code]) => code),
  tenant_owner: permissionCodes.map(([code]) => code),
  partner: [
    "mailbox.view",
    "mailbox.connect",
    "mail.send",
    "mail.draft.save",
    "mail.ai.compose",
    "file.upload",
    "client.matter.access",
    "user.invite",
    "domain.manage",
    "audit.view",
    "ai.workspace"
  ],
  lawyer: [
    "mailbox.view",
    "mail.send",
    "mail.draft.save",
    "mail.ai.compose",
    "file.upload",
    "client.matter.access",
    "ai.workspace"
  ],
  trainee_lawyer: [
    "mailbox.view",
    "mail.draft.save",
    "mail.ai.compose",
    "client.matter.access",
    "ai.workspace"
  ],
  secretary: [
    "mailbox.view",
    "mail.send",
    "mail.draft.save",
    "mail.label.manage",
    "file.upload",
    "client.matter.access"
  ],
  office_manager: [
    "mailbox.view",
    "mailbox.connect",
    "mailbox.create",
    "mail.send",
    "mail.draft.save",
    "mail.label.manage",
    "user.invite",
    "billing.view",
    "domain.manage",
    "audit.view"
  ],
  read_only_auditor: ["mailbox.view", "audit.view"]
};

async function main(): Promise<void> {
  const plans = [
    {
      code: "starter",
      name: "Starter",
      tier: PlanTier.STARTER,
      maxUsers: 10,
      maxMailboxes: 10,
      maxAiTokens: 200_000,
      priceMonthly: 99
    },
    {
      code: "professional",
      name: "Professional",
      tier: PlanTier.PROFESSIONAL,
      maxUsers: 50,
      maxMailboxes: 100,
      maxAiTokens: 2_000_000,
      priceMonthly: 399
    }
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      create: {
        ...plan,
        currency: "USD"
      },
      update: {
        ...plan,
        currency: "USD",
        active: true
      }
    });
  }

  for (const [code, name] of permissionCodes) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, name },
      update: { name }
    });
  }

  const systemRoles = [
    ["super_admin", "Super Admin"],
    ["tenant_owner", "Tenant Owner"],
    ["partner", "Partner"],
    ["lawyer", "Lawyer"],
    ["trainee_lawyer", "Trainee Lawyer"],
    ["secretary", "Secretary"],
    ["office_manager", "Office Manager"],
    ["read_only_auditor", "Read-only Auditor"]
  ] as const;

  for (const [code, name] of systemRoles) {
    const existingRole = await prisma.role.findFirst({
      where: { code, tenantId: null }
    });

    const role = existingRole
      ? await prisma.role.update({
          where: { id: existingRole.id },
          data: { name, deletedAt: null, isSystem: true }
        })
      : await prisma.role.create({
          data: {
            code,
            name,
            isSystem: true,
            tenantId: null
          }
        });

    const assigned = roleMap[code] ?? [];
    const permissions = await prisma.permission.findMany({
      where: { code: { in: assigned } }
    });

    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id
          }
        },
        create: {
          roleId: role.id,
          permissionId: permission.id
        },
        update: {}
      });
    }
  }

  const tenantOwnerRole = await prisma.role.findFirstOrThrow({
    where: {
      code: "tenant_owner",
      tenantId: null
    }
  });

  const demoOwnerEmail = "owner@demo.lexoffice.ai";
  const hash = await bcrypt.hash("ChangeMe123!", 12);

  const user = await prisma.user.upsert({
    where: { email: demoOwnerEmail },
    create: {
      email: demoOwnerEmail,
      normalizedEmail: demoOwnerEmail.toLowerCase(),
      firstName: "Demo",
      lastName: "Owner",
      passwordHash: hash,
      active: true,
      emailVerifiedAt: new Date()
    },
    update: {
      firstName: "Demo",
      lastName: "Owner",
      passwordHash: hash,
      emailVerifiedAt: new Date(),
      active: true
    }
  });

  const professionalPlan = await prisma.subscriptionPlan.findUniqueOrThrow({
    where: { code: "professional" }
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo-hukuk" },
    create: {
      name: "Demo Hukuk Ofisi",
      slug: "demo-hukuk",
      ownerUserId: user.id,
      planId: professionalPlan.id,
      locale: "tr-TR",
      timezone: "Europe/Istanbul"
    },
    update: {
      name: "Demo Hukuk Ofisi",
      ownerUserId: user.id,
      planId: professionalPlan.id,
      deletedAt: null
    }
  });

  await prisma.tenantSettings.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      maxUsers: 50,
      maxMailboxes: 100,
      maxAiTokensPerMonth: 2_000_000,
      enforceMfa: true,
      aiEnabled: true,
      aiHumanApprovalRequired: true
    },
    update: {
      maxUsers: 50,
      maxMailboxes: 100,
      maxAiTokensPerMonth: 2_000_000,
      enforceMfa: true,
      aiEnabled: true,
      aiHumanApprovalRequired: true
    }
  });

  await prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id
      }
    },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      roleId: tenantOwnerRole.id,
      status: "ACTIVE",
      joinedAt: new Date()
    },
    update: {
      roleId: tenantOwnerRole.id,
      status: "ACTIVE",
      joinedAt: new Date(),
      deletedAt: null
    }
  });

  const domain = await prisma.domain.upsert({
    where: {
      tenantId_domainName: {
        tenantId: tenant.id,
        domainName: "demo-hukuk.com"
      }
    },
    create: {
      tenantId: tenant.id,
      domainName: "demo-hukuk.com",
      provider: "MANAGED",
      onboardingMode: "MANAGED",
      status: "MAIL_READY",
      verificationToken: "demo-token",
      verifiedAt: new Date(),
      mailReadyAt: new Date()
    },
    update: {
      provider: "MANAGED",
      onboardingMode: "MANAGED",
      status: "MAIL_READY",
      deletedAt: null
    }
  });

  const requiredDns = [
    { type: "TXT", host: "_lexoffice-verification", value: "lexoffice-verification=demo-token" },
    { type: "SPF", host: "@", value: "v=spf1 include:_spf.lexoffice.ai ~all" },
    { type: "DKIM", host: "selector1._domainkey", value: "selector1._domainkey.demo-hukuk.com" },
    { type: "DMARC", host: "_dmarc", value: "v=DMARC1; p=none; rua=mailto:dmarc@demo-hukuk.com" },
    { type: "MX", host: "@", value: "mx1.lexoffice.ai" }
  ] as const;

  for (const record of requiredDns) {
    await prisma.domainDnsRecord.upsert({
      where: {
        domainId_type_host_value: {
          domainId: domain.id,
          type: record.type,
          host: record.host,
          value: record.value
        }
      },
      create: {
        tenantId: tenant.id,
        domainId: domain.id,
        type: record.type,
        host: record.host,
        value: record.value,
        verified: true,
        required: true
      },
      update: {
        verified: true,
        required: true
      }
    });
  }

  const mailbox = await prisma.mailbox.upsert({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: "info@demo-hukuk.com"
      }
    },
    create: {
      tenantId: tenant.id,
      domainId: domain.id,
      provider: "MANAGED",
      email: "info@demo-hukuk.com",
      displayName: "Genel Ofis",
      status: "ACTIVE"
    },
    update: {
      domainId: domain.id,
      provider: "MANAGED",
      status: "ACTIVE",
      deletedAt: null
    }
  });

  await prisma.mailboxSyncState.upsert({
    where: {
      mailboxId_provider: {
        mailboxId: mailbox.id,
        provider: "MANAGED"
      }
    },
    create: {
      tenantId: tenant.id,
      mailboxId: mailbox.id,
      provider: "MANAGED",
      syncStatus: "IDLE",
      lastSyncedAt: new Date()
    },
    update: {
      syncStatus: "IDLE",
      lastSyncedAt: new Date()
    }
  });

  const thread = await prisma.mailThread.upsert({
    where: {
      tenantId_mailboxId_providerThreadId: {
        tenantId: tenant.id,
        mailboxId: mailbox.id,
        providerThreadId: "demo-thread-1"
      }
    },
    create: {
      tenantId: tenant.id,
      mailboxId: mailbox.id,
      providerThreadId: "demo-thread-1",
      subject: "Yeni dava dosyası için belge talebi",
      normalizedSubject: "yeni dava dosyası için belge talebi",
      snippet: "Merhaba, dava dosyası için aşağıdaki belgeleri iletebilir misiniz?",
      messageCount: 1,
      unreadCount: 1,
      lastMessageAt: new Date()
    },
    update: {
      subject: "Yeni dava dosyası için belge talebi",
      snippet: "Merhaba, dava dosyası için aşağıdaki belgeleri iletebilir misiniz?",
      messageCount: 1,
      unreadCount: 1,
      lastMessageAt: new Date(),
      deletedAt: null
    }
  });

  await prisma.mailMessage.upsert({
    where: {
      tenantId_mailboxId_providerMessageId: {
        tenantId: tenant.id,
        mailboxId: mailbox.id,
        providerMessageId: "demo-message-1"
      }
    },
    create: {
      tenantId: tenant.id,
      mailboxId: mailbox.id,
      threadId: thread.id,
      providerMessageId: "demo-message-1",
      direction: "INBOUND",
      state: "RECEIVED",
      subject: "Yeni dava dosyası için belge talebi",
      snippet: "Merhaba, dava dosyası için aşağıdaki belgeleri iletebilir misiniz?",
      bodyText:
        "Merhaba, müvekkil adına açılan dava dosyası için kimlik fotokopisi ve sözleşme suretlerini bugün içerisinde iletebilir misiniz?",
      fromEmail: "musteri@example.com",
      fromName: "Müvekkil",
      receivedAt: new Date(),
      isRead: false,
      isSensitive: true
    },
    update: {
      threadId: thread.id,
      snippet: "Merhaba, dava dosyası için aşağıdaki belgeleri iletebilir misiniz?",
      bodyText:
        "Merhaba, müvekkil adına açılan dava dosyası için kimlik fotokopisi ve sözleşme suretlerini bugün içerisinde iletebilir misiniz?",
      fromEmail: "musteri@example.com",
      fromName: "Müvekkil",
      receivedAt: new Date(),
      isRead: false,
      isSensitive: true,
      deletedAt: null
    }
  });

  console.info(
    "Seed tamamlandı. Demo kullanıcı: owner@demo.lexoffice.ai / ChangeMe123!, tenant: demo-hukuk, mailbox: info@demo-hukuk.com"
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
