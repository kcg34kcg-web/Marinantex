/* eslint-disable no-console */

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const CASE_TEST_FILES = [
  'tests/dashboard-cases-access.test.ts',
  'tests/dashboard-cases-create-route.test.ts',
  'tests/dashboard-cases-list-route.test.ts',
  'tests/dashboard-cases-documents-route.test.ts',
  'tests/dashboard-cases-detail-route.test.ts',
  'tests/dashboard-cases-timeline-route.test.ts',
  'tests/dashboard-cases-clients-route.test.ts',
  'tests/dashboard-cases-status-route.test.ts',
  'tests/dashboard-cases-notes-route.test.ts',
  'tests/dashboard-cases-tasks-route.test.ts',
];

const CHECK_TARGETS = {
  access: 'lib/dashboard/access.ts',
  statusRoute: 'app/api/dashboard/cases/status/route.ts',
  notesRoute: 'app/api/dashboard/cases/notes/route.ts',
  tasksRoute: 'app/api/dashboard/cases/tasks/route.ts',
  tasksBulkRoute: 'app/api/dashboard/cases/tasks/bulk/route.ts',
  createRoute: 'app/api/dashboard/cases/create/route.ts',
  listRoute: 'app/api/dashboard/cases/list/route.ts',
  documentsRoute: 'app/api/dashboard/cases/documents/route.ts',
  detailRoute: 'app/api/dashboard/cases/detail/route.ts',
  timelineRoute: 'app/api/dashboard/cases/timeline/route.ts',
  clientsRoute: 'app/api/dashboard/cases/clients/route.ts',
  teamMembersRoute: 'app/api/office/team/members/route.ts',
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function expectIncludes(content, needle, context) {
  assert(content.includes(needle), `${context}: expected to include "${needle}"`);
}

function expectRegex(content, pattern, context) {
  assert(pattern.test(content), `${context}: expected pattern ${pattern}`);
}

async function readTargets() {
  const entries = await Promise.all(
    Object.entries(CHECK_TARGETS).map(async ([key, file]) => {
      const content = await readFile(file, 'utf8');
      return [key, content];
    }),
  );
  return Object.fromEntries(entries);
}

function runChecklist(contentByKey) {
  const findings = [];

  const addFinding = (name, fn) => {
    try {
      fn();
      findings.push({ name, ok: true });
    } catch (error) {
      findings.push({
        name,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  addFinding('Case access helper enforces bureau scope for assistants', () => {
    const content = contentByKey.access;
    expectIncludes(content, "resolveInternalUserBureauScope", CHECK_TARGETS.access);
    expectIncludes(content, "if (input.role === 'lawyer')", CHECK_TARGETS.access);
    expectIncludes(content, "return caseResult.data.lawyer_id === input.userId;", CHECK_TARGETS.access);
    expectIncludes(content, 'if (caseResult.data.bureau_id)', CHECK_TARGETS.access);
    expectIncludes(content, 'return caseResult.data.bureau_id === scope.bureauId;', CHECK_TARGETS.access);
    expectIncludes(content, 'return scope.bureauProfileIds.includes(caseResult.data.lawyer_id);', CHECK_TARGETS.access);
    assert(
      !/role === 'assistant'[\s\S]{0,120}return true/.test(content),
      `${CHECK_TARGETS.access}: assistant role must not have unconditional allow`,
    );
  });

  addFinding('Status route checks access per case and deduplicates ids', () => {
    const content = contentByKey.statusRoute;
    expectIncludes(content, "import { canAccessCase }", CHECK_TARGETS.statusRoute);
    expectIncludes(content, 'const uniqueCaseIds = [...new Set(payload.caseIds)];', CHECK_TARGETS.statusRoute);
    expectIncludes(content, "return Response.json({ error: 'Seçilen dosyalardan en az birine erişim yetkiniz yok.' }, { status: 403 });", CHECK_TARGETS.statusRoute);
    expectIncludes(content, ".in('id', uniqueCaseIds)", CHECK_TARGETS.statusRoute);
  });

  addFinding('Notes route protects both list and create operations', () => {
    const content = contentByKey.notesRoute;
    expectIncludes(content, "import { canAccessCase }", CHECK_TARGETS.notesRoute);
    const accessCallCount = (content.match(/canAccessCase\(/g) ?? []).length;
    assert(accessCallCount >= 2, `${CHECK_TARGETS.notesRoute}: expected canAccessCase checks in both GET and POST`);
  });

  addFinding('Task routes validate case access and assignee office scope', () => {
    const taskContent = contentByKey.tasksRoute;
    const bulkContent = contentByKey.tasksBulkRoute;
    expectIncludes(taskContent, "import { canAccessCase }", CHECK_TARGETS.tasksRoute);
    expectIncludes(taskContent, "resolveInternalUserBureauScope", CHECK_TARGETS.tasksRoute);
    expectIncludes(taskContent, "Görev atananı ofis kapsamı dışında.", CHECK_TARGETS.tasksRoute);
    expectIncludes(bulkContent, "import { canAccessCase }", CHECK_TARGETS.tasksBulkRoute);
    expectIncludes(bulkContent, "resolveInternalUserBureauScope", CHECK_TARGETS.tasksBulkRoute);
    expectIncludes(bulkContent, "Görev atananı ofis kapsamı dışında.", CHECK_TARGETS.tasksBulkRoute);
  });

  addFinding('Case creation is bureau-scoped for lawyer/client selection and insert', () => {
    const content = contentByKey.createRoute;
    expectIncludes(content, "resolveInternalUserBureauScope", CHECK_TARGETS.createRoute);
    expectIncludes(content, "resolveAccessibleClientIds", CHECK_TARGETS.createRoute);
    expectIncludes(content, ".in('id', scope.bureauProfileIds)", CHECK_TARGETS.createRoute);
    expectRegex(content, /bureau_id:\s*scope\.bureauId/, CHECK_TARGETS.createRoute);
    expectIncludes(content, "return Response.json({ error: 'Büro kapsamı doğrulanamadi.' }, { status: 403 });", CHECK_TARGETS.createRoute);
  });

  addFinding('Case listing is office-scoped for assistant role', () => {
    const content = contentByKey.listRoute;
    expectIncludes(content, "if (access.role === 'assistant')", CHECK_TARGETS.listRoute);
    expectIncludes(content, "resolveInternalUserBureauScope", CHECK_TARGETS.listRoute);
    expectIncludes(content, "casesQuery = casesQuery.in('lawyer_id', scopedLawyerIds);", CHECK_TARGETS.listRoute);
    expectIncludes(content, 'const chunkSize = 400;', CHECK_TARGETS.listRoute);
    expectIncludes(content, 'const maxChunks = 10;', CHECK_TARGETS.listRoute);
  });

  addFinding('Document upload requires allowed extension and allowed MIME when present', () => {
    const content = contentByKey.documentsRoute;
    expectIncludes(content, 'if (!hasAllowedExtension || (mimeType.length > 0 && !hasAllowedMimeType))', CHECK_TARGETS.documentsRoute);
  });

  addFinding('Team members endpoint is bureau-scoped', () => {
    const content = contentByKey.teamMembersRoute;
    expectIncludes(content, "resolveInternalUserBureauScope", CHECK_TARGETS.teamMembersRoute);
    expectIncludes(content, ".in('id', scope.bureauProfileIds)", CHECK_TARGETS.teamMembersRoute);
  });

  addFinding('Detail route requires case-level access check', () => {
    const content = contentByKey.detailRoute;
    expectIncludes(content, "import { canAccessCase }", CHECK_TARGETS.detailRoute);
    expectIncludes(content, "if (!allowed)", CHECK_TARGETS.detailRoute);
    expectIncludes(content, "Bu dosyayi görüntüleme yetkiniz yok.", CHECK_TARGETS.detailRoute);
  });

  addFinding('Timeline route protects read/write operations and delete role guard', () => {
    const content = contentByKey.timelineRoute;
    const accessCallCount = (content.match(/canAccessCase\(/g) ?? []).length;
    expectIncludes(content, "import { canAccessCase }", CHECK_TARGETS.timelineRoute);
    assert(accessCallCount >= 4, `${CHECK_TARGETS.timelineRoute}: expected canAccessCase checks in GET/POST/PATCH/DELETE`);
    expectIncludes(content, "if (access.role !== 'lawyer')", CHECK_TARGETS.timelineRoute);
    expectIncludes(content, "Timeline event silme için avukat yetkisi gerekir.", CHECK_TARGETS.timelineRoute);
  });

  addFinding('Case-client link routes require case access', () => {
    const content = contentByKey.clientsRoute;
    const accessCallCount = (content.match(/canAccessCase\(/g) ?? []).length;
    expectIncludes(content, "import { canAccessCase }", CHECK_TARGETS.clientsRoute);
    assert(accessCallCount >= 2, `${CHECK_TARGETS.clientsRoute}: expected canAccessCase checks in POST and DELETE`);
    expectIncludes(content, "Bu dosyada müvekkil esleme yetkiniz yok.", CHECK_TARGETS.clientsRoute);
  });

  return findings;
}

function printFindings(findings) {
  console.log('[cases-security-smoke] static checklist');
  for (const finding of findings) {
    if (finding.ok) {
      console.log(`  [PASS] ${finding.name}`);
    } else {
      console.log(`  [FAIL] ${finding.name}`);
      console.log(`         ${finding.message}`);
    }
  }
}

function runTargetedTests() {
  const testArgs = ['run', 'test:web', '--', '--run', ...CASE_TEST_FILES];
  const result = spawnSync('npm', testArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`targeted cases tests failed.\n${output}`);
  }

  const output = result.stdout?.trim() ?? '';
  const lines = output.split('\n').filter(Boolean);
  const tail = lines.slice(-8).join('\n');
  console.log('[cases-security-smoke] targeted tests passed');
  if (tail) {
    console.log(tail);
  }
}

async function run() {
  console.log('[cases-security-smoke] starting');
  console.log(`[cases-security-smoke] cwd=${process.cwd()}`);

  const contentByKey = await readTargets();
  const findings = runChecklist(contentByKey);
  printFindings(findings);

  const failures = findings.filter((finding) => !finding.ok);
  if (failures.length > 0) {
    throw new Error(`${failures.length} static checklist item(s) failed.`);
  }

  const skipTests = String(process.env.SKIP_CASES_SECURITY_TESTS ?? 'false').toLowerCase() === 'true';
  if (skipTests) {
    console.log('[cases-security-smoke] skipping targeted tests (SKIP_CASES_SECURITY_TESTS=true)');
  } else {
    runTargetedTests();
  }

  console.log('[cases-security-smoke] all checks passed');
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
