import { expect, test, type Page } from "@playwright/test";

const DEMO_EMAIL = "owner@demo.lexoffice.ai";
const DEMO_PASSWORD = "ChangeMe123!";
const DEMO_TENANT_SLUG = "demo-hukuk";

async function loginAsDemoUser(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("E-posta").fill(DEMO_EMAIL);
  await page.getByLabel("Şifre").fill(DEMO_PASSWORD);
  await page.getByLabel("Tenant Slug").fill(DEMO_TENANT_SLUG);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await page.waitForURL(`**/${DEMO_TENANT_SLUG}/dashboard`);
}

test.describe("LexOffice AI kritik akış smoke", () => {
  test("sign-in sayfası yüklenir", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "LexOffice AI Giriş" })).toBeVisible();
  });

  test("tenant dashboard route erişilebilir", async ({ page }) => {
    await loginAsDemoUser(page);
    await expect(page.getByText("Demo Hukuk Ofisi")).toBeVisible();
    await expect(page.getByText("Dashboard")).toBeVisible();
  });

  test("domain yönetim ekranı render olur", async ({ page }) => {
    await loginAsDemoUser(page);
    await page.goto("/demo-hukuk/settings/domains");
    await expect(page.getByText("Domain Onboarding Wizard")).toBeVisible();
    await expect(page.getByText("Mailbox Connect Wizard")).toBeVisible();
  });
});
