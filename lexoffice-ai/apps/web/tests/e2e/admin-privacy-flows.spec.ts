import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@lexoffice/db";

const DEMO_EMAIL = "owner@demo.lexoffice.ai";
const DEMO_PASSWORD = "ChangeMe123!";
const DEMO_TENANT_SLUG = "demo-hukuk";
const ADMIN_ROLE_TEST_EMAIL = "admin-role-e2e@demo.lexoffice.ai";
const ADMIN_DEACTIVATE_TEST_EMAIL = "admin-deactivate-e2e@demo.lexoffice.ai";
const BASE_PATH = normalizeBasePath(process.env.MAIL_WORKSPACE_BASE_PATH ?? "/mail-workspace");

function route(pathname: string): string {
  return `${BASE_PATH}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

async function loginAsOwner(page: Page): Promise<void> {
  await page.goto(route("/sign-in"));
  await page.getByLabel("E-posta").fill(DEMO_EMAIL);
  await page.getByLabel("Şifre").fill(DEMO_PASSWORD);
  await page.getByLabel("Tenant Slug").fill(DEMO_TENANT_SLUG);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`**/${DEMO_TENANT_SLUG}/dashboard`);
}

async function ensureMember(email: string, roleCode: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { slug: DEMO_TENANT_SLUG },
    select: { id: true }
  });

  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: DEMO_EMAIL },
    select: { id: true, passwordHash: true }
  });

  const role = await prisma.role.findFirstOrThrow({
    where: {
      code: roleCode,
      tenantId: null,
      deletedAt: null
    },
    select: { id: true }
  });

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      normalizedEmail: email.toLowerCase(),
      firstName: "Admin",
      lastName: "E2E",
      passwordHash: owner.passwordHash,
      active: true,
      emailVerifiedAt: new Date()
    },
    update: {
      firstName: "Admin",
      lastName: "E2E",
      passwordHash: owner.passwordHash,
      active: true,
      deletedAt: null
    }
  });

  const membership = await prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id
      }
    },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      roleId: role.id,
      status: "ACTIVE",
      joinedAt: new Date(),
      invitedById: owner.id,
      invitedAt: new Date()
    },
    update: {
      roleId: role.id,
      status: "ACTIVE",
      deletedAt: null,
      joinedAt: new Date()
    }
  });

  return {
    tenantId: tenant.id,
    userId: user.id,
    membershipId: membership.id
  };
}

test.describe("Admin + Privacy akışları", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("admin panelde rol güncelleme ve kullanıcı pasifleştirme çalışır", async ({ page }) => {
    const roleMember = await ensureMember(ADMIN_ROLE_TEST_EMAIL, "lawyer");
    const deactivateMember = await ensureMember(ADMIN_DEACTIVATE_TEST_EMAIL, "lawyer");

    await loginAsOwner(page);
    await page.goto(route(`/${DEMO_TENANT_SLUG}/admin`));
    await expect(page.getByRole("heading", { name: "Admin Panel" })).toBeVisible();

    const roleRow = page.locator("tr", { hasText: ADMIN_ROLE_TEST_EMAIL }).first();
    await expect(roleRow).toBeVisible();
    await roleRow.locator("select").selectOption("secretary");
    await roleRow.getByRole("button", { name: "Rol Güncelle" }).click();

    await expect
      .poll(async () => {
        const membership = await prisma.membership.findUnique({
          where: {
            tenantId_userId: {
              tenantId: roleMember.tenantId,
              userId: roleMember.userId
            }
          },
          include: {
            role: {
              select: {
                code: true
              }
            }
          }
        });
        return membership?.role.code ?? null;
      })
      .toBe("secretary");

    const deactivateRow = page.locator("tr", { hasText: ADMIN_DEACTIVATE_TEST_EMAIL }).first();
    await expect(deactivateRow).toBeVisible();

    const deactivateResponse = await page.request.post(
      route(`/api/v1/admin/members/${deactivateMember.membershipId}/deactivate`),
      {
        data: {
          tenantId: deactivateMember.tenantId
        }
      }
    );
    expect(deactivateResponse.ok()).toBeTruthy();

    await expect
      .poll(async () => {
        const membership = await prisma.membership.findUnique({
          where: {
            tenantId_userId: {
              tenantId: deactivateMember.tenantId,
              userId: deactivateMember.userId
            }
          },
          select: {
            status: true,
            deletedAt: true
          }
        });
        return {
          status: membership?.status ?? null,
          deletedAt: membership?.deletedAt ? "set" : null
        };
      })
      .toEqual({
        status: "REMOVED",
        deletedAt: "set"
      });
  });

  test("settings privacy export ve silme talebi çalışır, admin loga düşer", async ({ page }) => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: DEMO_EMAIL },
      select: { id: true }
    });
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { slug: DEMO_TENANT_SLUG },
      select: { id: true }
    });

    await loginAsOwner(page);
    await page.goto(route(`/${DEMO_TENANT_SLUG}/settings`));

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Verilerimi Dışa Aktar" }).click()
    ]);
    await expect(download.suggestedFilename()).toContain("privacy-export");

    const reason = `Playwright erase request ${Date.now()}`;
    await page.getByPlaceholder("Talebinize ek not bırakabilirsiniz.").fill(reason);
    await page.getByRole("button", { name: "Silme Talebi Oluştur" }).click();
    await expect(page.getByText("Silme talebi kaydedildi ve güvenlik loglarına işlendi")).toBeVisible();

    await expect
      .poll(async () => {
        const event = await prisma.securityEvent.findFirst({
          where: {
            tenantId: tenant.id,
            userId: owner.id,
            eventType: "privacy.erase.requested"
          },
          orderBy: {
            createdAt: "desc"
          },
          select: {
            id: true
          }
        });
        return event?.id ?? null;
      })
      .not.toBeNull();

    await page.goto(route(`/${DEMO_TENANT_SLUG}/admin`));
    await expect(page.getByText("privacy.erase.requested").first()).toBeVisible();
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
