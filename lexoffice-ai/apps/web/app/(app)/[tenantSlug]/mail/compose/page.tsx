import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@lexoffice/db";
import { ComposeEditor } from "@/components/mail/compose-editor";
import { getTenantContext } from "@/lib/tenant-context";

type ComposeMode = "reply" | "reply-all" | "forward";

type InitialDraftPayload = {
  id?: string;
  subject: string;
  bodyText: string;
  toRecipients: string[];
  ccRecipients: string[];
  bccRecipients: string[];
};

type ComposeSignature = {
  id: string;
  name: string;
  htmlBody: string;
  textBody: string | null;
  isDefault: boolean;
};

type ComposeMailboxOption = {
  id: string;
  email: string;
  displayName: string | null;
};

type ComposeFont = "system" | "sans" | "serif" | "mono";

export default async function ComposePage({
  params,
  searchParams
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    draftId?: string;
    mailboxId?: string;
    threadId?: string;
    messageId?: string;
    mode?: string;
    aiDraftSubject?: string;
    aiDraftBody?: string;
  }>;
}) {
  const { tenantSlug } = await params;
  const query = await searchParams;
  const { tenant, session } = await getTenantContext(tenantSlug);
  const composeMode = parseComposeMode(query.mode);

  const draft = query.draftId
    ? await prisma.draft.findFirst({
        where: {
          id: query.draftId,
          tenantId: tenant.id,
          createdByUserId: session.userId,
          deletedAt: null
        }
      })
    : null;

  const sourceMessage =
    !draft && composeMode && query.threadId && query.messageId
      ? await prisma.mailMessage.findFirst({
          where: {
            id: query.messageId,
            threadId: query.threadId,
            tenantId: tenant.id,
            deletedAt: null
          },
          select: {
            id: true,
            threadId: true,
            mailboxId: true,
            fromName: true,
            fromEmail: true,
            subject: true,
            bodyText: true,
            snippet: true,
            sentAt: true,
            receivedAt: true,
            recipients: {
              select: {
                type: true,
                email: true
              }
            }
          }
        })
      : null;

  const mailboxOptions: ComposeMailboxOption[] = await prisma.mailbox.findMany({
    where: {
      tenantId: tenant.id,
      deletedAt: null
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      displayName: true
    }
  });

  if (mailboxOptions.length === 0) {
    notFound();
  }

  const resolvedMailboxId = resolveInitialMailboxId({
    mailboxOptions,
    draftMailboxId: draft?.mailboxId,
    queryMailboxId: query.mailboxId,
    sourceMailboxId: sourceMessage?.mailboxId,
    defaultMailboxId: tenant.settings?.defaultSenderMailboxId ?? null
  });
  const mailbox = mailboxOptions.find((entry) => entry.id === resolvedMailboxId);

  if (!mailbox) {
    notFound();
  }

  const signatures: ComposeSignature[] = await prisma.signature.findMany({
    where: {
      tenantId: tenant.id
    },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      name: true,
      htmlBody: true,
      textBody: true,
      isDefault: true
    }
  });

  const aiDraftOverride = resolveAiDraftOverride(query.aiDraftSubject, query.aiDraftBody);

  const initialDraft: InitialDraftPayload | undefined = draft
    ? {
        id: draft.id,
        subject: draft.subject ?? "",
        bodyText: draft.bodyText ?? "",
        toRecipients: parseRecipients(draft.toRecipients),
        ccRecipients: parseRecipients(draft.ccRecipients),
        bccRecipients: parseRecipients(draft.bccRecipients)
      }
    : sourceMessage && composeMode
      ? applyAiDraftOverride(buildReplyPrefill(sourceMessage, mailbox.email, composeMode), aiDraftOverride)
      : aiDraftOverride
        ? {
            subject: aiDraftOverride.subject,
            bodyText: aiDraftOverride.bodyText,
            toRecipients: [],
            ccRecipients: [],
            bccRecipients: []
          }
      : undefined;

  const sendContext =
    sourceMessage && composeMode
      ? {
          mode: composeMode,
          ...(composeMode === "forward"
            ? {}
            : {
                threadId: sourceMessage.threadId,
                inReplyToMessageId: sourceMessage.id
              })
        }
      : undefined;

  const pageTitle = composeMode ? mapComposeTitle(composeMode) : "Compose";

  return (
    <div className="min-h-screen bg-[#f6f8fc] px-4 py-4 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-900">{pageTitle}</h1>
          <p className="text-sm text-slate-500">{mailbox.email}</p>
        </div>
        <Link
          href={`/${tenantSlug}/mail`}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          Gelen Kutusuna Dön
        </Link>
      </div>
      <div className="mx-auto max-w-5xl">
        <ComposeEditor
          tenantSlug={tenantSlug}
          tenantId={tenant.id}
          mailboxOptions={mailboxOptions}
          initialMailboxId={mailbox.id}
          composeDefaultFont={normalizeComposeFont(tenant.settings?.composeDefaultFont)}
          signatures={signatures}
          {...(initialDraft ? { initialDraft } : {})}
          {...(sendContext ? { sendContext } : {})}
        />
      </div>
    </div>
  );
}

function resolveInitialMailboxId({
  mailboxOptions,
  draftMailboxId,
  queryMailboxId,
  sourceMailboxId,
  defaultMailboxId
}: {
  mailboxOptions: ComposeMailboxOption[];
  draftMailboxId: string | undefined;
  queryMailboxId: string | undefined;
  sourceMailboxId: string | undefined;
  defaultMailboxId: string | null | undefined;
}): string {
  const candidates = [draftMailboxId, queryMailboxId, sourceMailboxId, defaultMailboxId].filter(
    (item): item is string => Boolean(item && item.trim().length > 0)
  );

  for (const candidate of candidates) {
    if (mailboxOptions.some((mailbox) => mailbox.id === candidate)) {
      return candidate;
    }
  }

  return mailboxOptions[0]?.id ?? "";
}

function normalizeComposeFont(value: string | null | undefined): ComposeFont {
  if (value === "sans" || value === "serif" || value === "mono") {
    return value;
  }

  return "system";
}

function parseRecipients(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item): item is string => typeof item === "string");
}

function parseComposeMode(value: string | undefined): ComposeMode | undefined {
  if (value === "reply" || value === "reply-all" || value === "forward") {
    return value;
  }
  return undefined;
}

function mapComposeTitle(mode: ComposeMode): string {
  if (mode === "reply") {
    return "Yanıtla";
  }

  if (mode === "reply-all") {
    return "Tümüne Yanıtla";
  }

  return "İlet";
}

function buildReplyPrefill(
  sourceMessage: {
    fromName: string | null;
    fromEmail: string | null;
    subject: string | null;
    bodyText: string | null;
    snippet: string | null;
    sentAt: Date | null;
    receivedAt: Date | null;
    recipients: Array<{
      type: "TO" | "CC" | "BCC";
      email: string;
    }>;
  },
  senderMailboxEmail: string,
  mode: ComposeMode
): InitialDraftPayload {
  const quotedHeader = [
    `Kimden: ${sourceMessage.fromName ?? sourceMessage.fromEmail ?? "-"}`,
    `Tarih: ${formatDate(sourceMessage.sentAt ?? sourceMessage.receivedAt)}`,
    `Konu: ${sourceMessage.subject ?? "(Konu yok)"}`
  ].join("\n");
  const quotedBodySource = sourceMessage.bodyText ?? sourceMessage.snippet ?? "";
  const quotedBody = `\n\n--- Orijinal Mesaj ---\n${quotedHeader}\n\n${quotedBodySource}`;

  if (mode === "forward") {
    return {
      subject: addSubjectPrefix(sourceMessage.subject, "Fwd"),
      bodyText: quotedBody,
      toRecipients: [],
      ccRecipients: [],
      bccRecipients: []
    };
  }

  const senderLower = senderMailboxEmail.trim().toLowerCase();
  const toFromRecipients = sourceMessage.recipients
    .filter((recipient) => recipient.type === "TO")
    .map((recipient) => recipient.email);
  const ccFromRecipients = sourceMessage.recipients
    .filter((recipient) => recipient.type === "CC")
    .map((recipient) => recipient.email);

  if (mode === "reply") {
    const fallback = [...toFromRecipients, ...ccFromRecipients].find(
      (email) => email.trim().toLowerCase() !== senderLower
    );
    const replyTo = sourceMessage.fromEmail && sourceMessage.fromEmail.trim().toLowerCase() !== senderLower
      ? sourceMessage.fromEmail
      : fallback;

    return {
      subject: addSubjectPrefix(sourceMessage.subject, "Re"),
      bodyText: quotedBody,
      toRecipients: replyTo ? [replyTo] : [],
      ccRecipients: [],
      bccRecipients: []
    };
  }

  const toCandidates = [
    ...(sourceMessage.fromEmail ? [sourceMessage.fromEmail] : []),
    ...toFromRecipients
  ];
  const toRecipients = uniqueRecipients(
    toCandidates.filter((email) => email.trim().toLowerCase() !== senderLower)
  );
  const ccRecipients = uniqueRecipients(
    ccFromRecipients.filter(
      (email) =>
        email.trim().toLowerCase() !== senderLower &&
        !toRecipients.some((item) => item.toLowerCase() === email.toLowerCase())
    )
  );

  return {
    subject: addSubjectPrefix(sourceMessage.subject, "Re"),
    bodyText: quotedBody,
    toRecipients,
    ccRecipients,
    bccRecipients: []
  };
}

function addSubjectPrefix(subject: string | null, prefix: "Re" | "Fwd"): string {
  const safeSubject = (subject ?? "").trim();
  if (safeSubject.length === 0) {
    return `${prefix}: (Konu yok)`;
  }

  const lower = safeSubject.toLowerCase();
  const targetPrefix = `${prefix.toLowerCase()}:`;
  if (lower.startsWith(targetPrefix)) {
    return safeSubject;
  }

  return `${prefix}: ${safeSubject}`;
}

function uniqueRecipients(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const email of items) {
    const trimmed = email.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function formatDate(value: Date | null): string {
  if (!value) {
    return "-";
  }

  return value.toLocaleString("tr-TR");
}

function resolveAiDraftOverride(
  subjectRaw: string | undefined,
  bodyRaw: string | undefined
): { subject: string; bodyText: string } | null {
  const subject = (subjectRaw ?? "").trim().slice(0, 200);
  const bodyText = (bodyRaw ?? "").trim().slice(0, 100_000);
  if (subject.length === 0 && bodyText.length === 0) {
    return null;
  }
  return {
    subject,
    bodyText
  };
}

function applyAiDraftOverride(
  base: InitialDraftPayload,
  override: { subject: string; bodyText: string } | null
): InitialDraftPayload {
  if (!override) {
    return base;
  }

  return {
    ...base,
    subject: override.subject.length > 0 ? override.subject : base.subject,
    bodyText: override.bodyText.length > 0 ? override.bodyText : base.bodyText
  };
}
