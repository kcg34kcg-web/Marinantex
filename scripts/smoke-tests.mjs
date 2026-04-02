/* eslint-disable no-console */

const webBaseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
const smokeAuthEmail = process.env.SMOKE_AUTH_EMAIL ?? "";
const smokeAuthPassword = process.env.SMOKE_AUTH_PASSWORD ?? "";
const smokeAuthTenantSlug = process.env.SMOKE_AUTH_TENANT_SLUG ?? "";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectStatus(label, response, expectedStatuses) {
  const expected = Array.isArray(expectedStatuses)
    ? expectedStatuses
    : [expectedStatuses];
  if (!expected.includes(response.status)) {
    const body = await response.text();
    throw new Error(
      `${label} failed: expected status ${expected.join("/")}, got ${
        response.status
      } body=${body.slice(0, 400)}`,
    );
  }
}

function getSetCookieLines(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const single = headers.get("set-cookie");
  if (!single) return [];
  return [single];
}

function applySetCookies(jar, response) {
  const lines = getSetCookieLines(response.headers);
  for (const line of lines) {
    const [cookiePart, ...attrParts] = line.split(";");
    const equalsIndex = cookiePart.indexOf("=");
    if (equalsIndex <= 0) continue;
    const name = cookiePart.slice(0, equalsIndex).trim();
    const value = cookiePart.slice(equalsIndex + 1);
    const hasMaxAgeZero = attrParts.some((attr) =>
      attr.trim().toLowerCase().startsWith("max-age=0"),
    );
    if (value === "" || hasMaxAgeZero) {
      jar.delete(name);
      continue;
    }
    jar.set(name, value);
  }
}

function buildCookieHeader(jar) {
  if (jar.size === 0) return undefined;
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function runAuthCookieFlowSmoke() {
  if (!smokeAuthEmail || !smokeAuthPassword || !smokeAuthTenantSlug) {
    console.log(
      "Auth cookie-flow smoke skipped (set SMOKE_AUTH_EMAIL, SMOKE_AUTH_PASSWORD, SMOKE_AUTH_TENANT_SLUG to enable).",
    );
    return;
  }

  const cookieJar = new Map();

  const loginResponse = await fetch(`${apiBaseUrl}/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: smokeAuthEmail,
      password: smokeAuthPassword,
      tenantSlug: smokeAuthTenantSlug,
    }),
  });
  await expectStatus("auth login", loginResponse, [200, 201]);
  applySetCookies(cookieJar, loginResponse);
  assert(cookieJar.size > 0, "auth login did not return cookies");
  assert(cookieJar.has("mx_access_token"), "mx_access_token cookie is missing after login");
  assert(cookieJar.has("mx_tenant_id"), "mx_tenant_id cookie is missing after login");

  const meResponse = await fetch(`${apiBaseUrl}/auth/me`, {
    headers: {
      cookie: buildCookieHeader(cookieJar),
    },
  });
  await expectStatus("auth me with login cookie", meResponse, 200);
  const mePayload = await meResponse.json();
  const tenantId = mePayload?.tenantId;
  assert(
    typeof tenantId === "string" && tenantId.length > 0,
    "auth me did not return tenantId",
  );

  const docsResponse = await fetch(`${apiBaseUrl}/documents`, {
    headers: {
      "x-tenant-id": tenantId,
      cookie: buildCookieHeader(cookieJar),
    },
  });
  await expectStatus("documents with auth cookie", docsResponse, 200);

  const logoutResponse = await fetch(`${apiBaseUrl}/auth/logout`, {
    method: "POST",
    headers: {
      cookie: buildCookieHeader(cookieJar),
    },
  });
  await expectStatus("auth logout", logoutResponse, [200, 201]);
  applySetCookies(cookieJar, logoutResponse);

  const docsAfterLogout = await fetch(`${apiBaseUrl}/documents`, {
    headers: {
      "x-tenant-id": tenantId,
      ...(buildCookieHeader(cookieJar)
        ? { cookie: buildCookieHeader(cookieJar) }
        : {}),
    },
  });
  await expectStatus("documents after logout", docsAfterLogout, 401);
}

async function run() {
  console.log("Running smoke tests...");
  console.log(`WEB_BASE_URL=${webBaseUrl}`);
  console.log(`API_BASE_URL=${apiBaseUrl}`);

  const webHealth = await fetch(`${webBaseUrl}/api/health`);
  await expectStatus("web health", webHealth, 200);
  const webHealthJson = await webHealth.json();
  assert(webHealthJson?.status === "ok", "web health payload status is not ok");

  const webRoot = await fetch(`${webBaseUrl}/`);
  await expectStatus("web root", webRoot, 200);
  assert(
    Boolean(webRoot.headers.get("x-frame-options")),
    "web x-frame-options header is missing",
  );
  assert(
    Boolean(webRoot.headers.get("x-content-type-options")),
    "web x-content-type-options header is missing",
  );

  const apiHealth = await fetch(`${apiBaseUrl}/health`);
  await expectStatus("api health", apiHealth, 200);
  const apiHealthJson = await apiHealth.json();
  assert(apiHealthJson?.status === "ok", "api health payload status is not ok");

  const apiDocumentsMissingTenant = await fetch(`${apiBaseUrl}/documents`);
  await expectStatus("documents without tenant", apiDocumentsMissingTenant, 400);

  const apiDocumentsMissingAuth = await fetch(`${apiBaseUrl}/documents`, {
    headers: {
      "x-tenant-id": "11111111-1111-4111-8111-111111111111",
    },
  });
  await expectStatus("documents without auth", apiDocumentsMissingAuth, 401);

  await runAuthCookieFlowSmoke();

  const invalidShareLink = await fetch(`${apiBaseUrl}/share-links/public/invalid-token`);
  await expectStatus("invalid share link", invalidShareLink, [400, 404]);

  console.log("Smoke tests passed.");
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
