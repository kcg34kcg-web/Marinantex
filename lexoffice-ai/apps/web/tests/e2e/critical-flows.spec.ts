import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@lexoffice/db";

const DEMO_EMAIL = "owner@demo.lexoffice.ai";
const DEMO_PASSWORD = "ChangeMe123!";
const DEMO_TENANT_SLUG = "demo-hukuk";
const SECRETARY_EMAIL = "secretary.e2e@demo.lexoffice.ai";
const BASE_PATH = normalizeBasePath(process.env.MAIL_WORKSPACE_BASE_PATH ?? "/mail-workspace");

function route(pathname: string): string {
  return `${BASE_PATH}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

async function login(
  page: Page,
  input: {
    email: string;
    password: string;
    tenantSlug: string;
  }
): Promise<void> {
  await page.goto(route("/sign-in"));
  await page.getByLabel("E-posta").fill(input.email);
  await page.getByLabel("Şifre").fill(input.password);
  await page.getByLabel("Tenant Slug").fill(input.tenantSlug);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`**/${input.tenantSlug}/dashboard`);
}

async function getDemoTenantContext() {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug: DEMO_TENANT_SLUG },
    select: {
      id: true
    }
  });

  const mailbox = await prisma.mailbox.findFirstOrThrow({
    where: {
      tenantId: tenant.id,
      deletedAt: null
    },
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true
    }
  });

  const thread = await prisma.mailThread.findFirstOrThrow({
    where: {
      tenantId: tenant.id,
      mailboxId: mailbox.id,
      deletedAt: null
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true
    }
  });

  return {
    tenantId: tenant.id,
    mailboxId: mailbox.id,
    threadId: thread.id
  };
}

async function ensureMatter(tenantId: string) {
  const client = await prisma.client.upsert({
    where: {
      tenantId_name: {
        tenantId,
        name: "E2E Müvekkil"
      }
    },
    create: {
      tenantId,
      name: "E2E Müvekkil",
      status: "active",
      email: "e2e-muvekkil@example.com"
    },
    update: {
      status: "active",
      deletedAt: null
    }
  });

  return prisma.matter.upsert({
    where: {
      tenantId_referenceNo: {
        tenantId,
        referenceNo: "E2E/2026/001"
      }
    },
    create: {
      tenantId,
      clientId: client.id,
      title: "E2E Matter Link Test",
      referenceNo: "E2E/2026/001",
      status: "open",
      description: "Playwright thread-to-matter link senaryosu"
    },
    update: {
      clientId: client.id,
      title: "E2E Matter Link Test",
      status: "open",
      deletedAt: null
    }
  });
}

async function ensureSecretaryUser(tenantId: string) {
  const role = await prisma.role.findFirstOrThrow({
    where: {
      code: "secretary",
      tenantId: null
    },
    select: {
      id: true
    }
  });

  const owner = await prisma.user.findUniqueOrThrow({
    where: {
      email: DEMO_EMAIL
    },
    select: {
      passwordHash: true
    }
  });

  if (!owner.passwordHash) {
    throw new Error("Demo owner password hash bulunamadı");
  }

  const user = await prisma.user.upsert({
    where: {
      email: SECRETARY_EMAIL
    },
    create: {
      email: SECRETARY_EMAIL,
      normalizedEmail: SECRETARY_EMAIL.toLowerCase(),
      firstName: "E2E",
      lastName: "Secretary",
      passwordHash: owner.passwordHash,
      active: true,
      emailVerifiedAt: new Date()
    },
    update: {
      firstName: "E2E",
      lastName: "Secretary",
      passwordHash: owner.passwordHash,
      active: true,
      emailVerifiedAt: new Date(),
      deletedAt: null
    }
  });

  await prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId,
        userId: user.id
      }
    },
    create: {
      tenantId,
      userId: user.id,
      roleId: role.id,
      status: "ACTIVE",
      joinedAt: new Date()
    },
    update: {
      roleId: role.id,
      status: "ACTIVE",
      deletedAt: null,
      joinedAt: new Date()
    }
  });
}

test.describe("LexOffice AI kritik akış e2e", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("unified inbox ve thread detay ekranı açılır", async ({ page }) => {
    await login(page, {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      tenantSlug: DEMO_TENANT_SLUG
    });

    await page.goto(route(`/${DEMO_TENANT_SLUG}/mail`));
    await expect(page.getByRole("button", { name: "Gelen Kutusu" })).toBeVisible();
    await expect(page.getByText("Yeni dava dosyası için belge talebi").first()).toBeVisible();

    await page.getByText("Yeni dava dosyası için belge talebi").first().click();
    await page.waitForURL(new RegExp(`.*/${DEMO_TENANT_SLUG}/mail/[^/]+$`));
    await expect(page.getByText("Mail Detay")).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI Action Panel" })).toBeVisible();
  });

  test("compose ekranında autosave ve gönderim çalışır", async ({ page }) => {
    await login(page, {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      tenantSlug: DEMO_TENANT_SLUG
    });

    const subject = `E2E Gönderim ${Date.now()}`;
    await page.goto(route(`/${DEMO_TENANT_SLUG}/mail/compose`));
    await page.getByPlaceholder("Kime").fill("alici@example.com");
    await page.getByPlaceholder("Konu").fill(subject);
    await page.getByPlaceholder("Mesaj").fill("Bu bir e2e gönderim testidir.");

    await expect(page.getByText("Taslak otomatik kaydedildi")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Gönder" }).click();
    await page.waitForURL(new RegExp(`.*/${DEMO_TENANT_SLUG}/mail/[^/]+$`));
    await expect(page.getByText("Mail Detay")).toBeVisible();
    await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  });

  test("thread matter'a bağlanır", async ({ page }) => {
    const context = await getDemoTenantContext();
    const matter = await ensureMatter(context.tenantId);

    await login(page, {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      tenantSlug: DEMO_TENANT_SLUG
    });

    await page.goto(route(`/${DEMO_TENANT_SLUG}/mail/${context.threadId}`));
    await page.getByPlaceholder("Matter ID girin").fill(matter.id);
    await page.getByRole("button", { name: "Matter'a Bağla" }).click();

    await expect(page.getByText("Thread başarıyla matter'a bağlandı").first()).toBeVisible();

    await expect
      .poll(async () => {
        const linked = await prisma.mailThread.findUnique({
          where: { id: context.threadId },
          select: { linkedMatterId: true }
        });
        return linked?.linkedMatterId;
      })
      .toBe(matter.id);
  });

  test("AI aksiyonu + feedback + audit kaydı görünür", async ({ page }) => {
    const context = await getDemoTenantContext();

    await login(page, {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      tenantSlug: DEMO_TENANT_SLUG
    });

    await page.goto(route(`/${DEMO_TENANT_SLUG}/mail/${context.threadId}`));
    await page.getByRole("button", { name: "Bu maili özetle" }).click();

    await expect(page.getByText("Özet:")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Kabul Et" }).click();
    await expect(page.getByText("Geri bildirim kaydedildi: Kabul")).toBeVisible();
    await expect(page.getByText("Tenant AI Metrikleri")).toBeVisible();

    await page.goto(route(`/${DEMO_TENANT_SLUG}/admin/audit`));
    await expect(page.getByText("ai.suggestion.feedback").first()).toBeVisible();
  });

  test("AI yetkisi olmayan rol AI aksiyonunu çalıştıramaz", async ({ page }) => {
    const context = await getDemoTenantContext();
    await ensureSecretaryUser(context.tenantId);

    const aiMessageCountBefore = await prisma.aIMessage.count({
      where: { tenantId: context.tenantId }
    });

    await login(page, {
      email: SECRETARY_EMAIL,
      password: DEMO_PASSWORD,
      tenantSlug: DEMO_TENANT_SLUG
    });

    await page.goto(route(`/${DEMO_TENANT_SLUG}/mail/${context.threadId}`));
    await page.getByRole("button", { name: "Bu maili özetle" }).click();
    await expect(page.getByText("İşlem için gerekli yetki: ai.workspace").first()).toBeVisible({
      timeout: 15_000
    });

    await expect
      .poll(async () => {
        return prisma.aIMessage.count({
          where: { tenantId: context.tenantId }
        });
      })
      .toBe(aiMessageCountBefore);
  });
});

function normalizeBasePath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "/") {
    return "";
  }

  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}
