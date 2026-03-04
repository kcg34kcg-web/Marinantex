/* eslint-disable no-console */

const webBaseUrl = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";

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

  const invalidShareLink = await fetch(`${apiBaseUrl}/share-links/public/invalid-token`);
  await expectStatus("invalid share link", invalidShareLink, [400, 404]);

  console.log("Smoke tests passed.");
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
