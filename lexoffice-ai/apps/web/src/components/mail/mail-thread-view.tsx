"use client";

import { useCallback, useMemo, useState } from "react";
import { AIActionPanel } from "@/components/ai/ai-action-panel";
import { ComposeEditor } from "./compose-editor";
import { MailThreadCalendarPanel } from "./mail-thread-calendar-panel";
import { MailThreadUtilityActions } from "./mail-thread-utility-actions";
import { MailMessageBody } from "./mail-message-body";
import { MailThreadActions } from "./mail-thread-actions";
import { MailThreadProductivityPanel } from "./mail-thread-productivity-panel";
import { MatterLinkPanel } from "./matter-link-panel";

type ThreadMessage = {
  id: string;
  mailboxId: string;
  internetMessageId: string | null;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  direction: "INBOUND" | "OUTBOUND";
  state: "RECEIVED" | "SENT" | "DRAFT" | "SCHEDULED" | "ARCHIVED" | "TRASH" | "SPAM";
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  isRead: boolean;
  sentAt: Date | null;
  receivedAt: Date | null;
  recipients: Array<{
    id: string;
    type: "TO" | "CC" | "BCC";
    name: string | null;
    email: string;
  }>;
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: bigint;
    virusScanStatus: string | null;
    downloadUrl: string | null;
  }>;
  labels: Array<{
    id: string;
    name: string;
  }>;
};

type ComposeFont = "system" | "sans" | "serif" | "mono";
type ComposeMode = "reply" | "reply-all" | "forward";
type ComposeMailboxOption = {
  id: string;
  email: string;
  displayName: string | null;
};

type InlineComposeState = {
  mode: ComposeMode;
  inReplyToMessageId: string;
  initialDraft: {
    subject: string;
    bodyText: string;
    toRecipients: string[];
    ccRecipients: string[];
    bccRecipients: string[];
  };
};

export function MailThreadView({
  tenantSlug,
  tenantId,
  thread,
  conversationViewEnabled = true,
  mailboxOptions,
  composeDefaultFont
}: {
  tenantSlug: string;
  tenantId: string;
  thread: {
    id: string;
    mailboxId: string;
    subject: string | null;
    matter?: {
      id: string;
      title: string;
      referenceNo: string | null;
    } | null;
    productivity?: {
      isPinned: boolean;
      pinnedAt: string | null;
      readLaterAt: string | null;
      reminderAt: string | null;
      note: string | null;
    } | null;
    messages: ThreadMessage[];
  };
  conversationViewEnabled?: boolean;
  mailboxOptions: ComposeMailboxOption[];
  composeDefaultFont: ComposeFont;
}) {
  const [inlineCompose, setInlineCompose] = useState<InlineComposeState | null>(null);
  const [composeSessionKey, setComposeSessionKey] = useState(0);
  const latestMessage = thread.messages[thread.messages.length - 1];
  const visibleMessages = conversationViewEnabled ? thread.messages : latestMessage ? [latestMessage] : [];
  const hasFollowUpLabel = latestMessage
    ? latestMessage.labels.some((label) => isFollowUpLabelName(label.name))
    : false;
  const initialMailboxId = useMemo(() => {
    const latestMailboxId = latestMessage?.mailboxId ?? thread.mailboxId;
    const exists = mailboxOptions.some((mailbox) => mailbox.id === latestMailboxId);
    if (exists && latestMailboxId) {
      return latestMailboxId;
    }
    return mailboxOptions[0]?.id ?? "";
  }, [latestMessage?.mailboxId, mailboxOptions, thread.mailboxId]);

  const openInlineCompose = useCallback(
    (mode: ComposeMode, context: { threadId: string; messageId: string }) => {
      if (!latestMessage || latestMessage.id !== context.messageId) {
        return;
      }

      const senderMailbox =
        mailboxOptions.find((mailbox) => mailbox.id === (latestMessage.mailboxId ?? thread.mailboxId)) ??
        mailboxOptions[0];
      const senderEmail = senderMailbox?.email ?? "";

      setInlineCompose({
        mode,
        inReplyToMessageId: context.messageId,
        initialDraft: buildReplyPrefill(latestMessage, senderEmail, mode)
      });
      setComposeSessionKey((previous) => previous + 1);
    },
    [latestMessage, mailboxOptions, thread.mailboxId]
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">{thread.subject ?? "(Konu yok)"}</h2>
            <div className="space-y-2">
              <MailThreadUtilityActions subject={thread.subject ?? "(Konu yok)"} />
              <MailThreadActions
                tenantSlug={tenantSlug}
                tenantId={tenantId}
                threadId={thread.id}
                mailboxId={thread.mailboxId}
                latestMessageId={latestMessage?.id ?? null}
                latestMessageState={latestMessage?.state ?? null}
                hasFollowUpLabel={hasFollowUpLabel}
                onCompose={openInlineCompose}
              />
            </div>
          </div>
        </header>

        <div className="divide-y divide-slate-100">
          {!conversationViewEnabled && thread.messages.length > 1 ? (
            <div className="px-4 py-2 text-xs text-slate-500">
              Konuşma görünümü kapalı. Yalnızca son mesaj gösteriliyor.
            </div>
          ) : null}

          {visibleMessages.map((message) => (
            <article key={message.id} className="px-4 py-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {message.fromName ?? message.fromEmail ?? "Gönderen"}
                  </p>
                  <p className="text-xs text-slate-500">{formatMessageDate(message.sentAt ?? message.receivedAt)}</p>
                </div>
                <dl className="mt-2 grid gap-1 text-xs text-slate-600">
                  {message.subject ? (
                    <div>
                      <dt className="inline font-medium text-slate-700">Konu:</dt>{" "}
                      <dd className="inline">{message.subject}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="inline font-medium text-slate-700">Gönderen:</dt>{" "}
                    <dd className="inline">{message.fromName ?? message.fromEmail ?? "-"}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-slate-700">Kime:</dt>{" "}
                    <dd className="inline">{formatRecipients(message.recipients, "TO")}</dd>
                  </div>
                  {message.recipients.some((recipient) => recipient.type === "CC") ? (
                    <div>
                      <dt className="inline font-medium text-slate-700">CC:</dt>{" "}
                      <dd className="inline">{formatRecipients(message.recipients, "CC")}</dd>
                    </div>
                  ) : null}
                  {message.recipients.some((recipient) => recipient.type === "BCC") ? (
                    <div>
                      <dt className="inline font-medium text-slate-700">BCC:</dt>{" "}
                      <dd className="inline">{formatRecipients(message.recipients, "BCC")}</dd>
                    </div>
                  ) : message.direction === "OUTBOUND" ? (
                    <div>
                      <dt className="inline font-medium text-slate-700">BCC:</dt>{" "}
                      <dd className="inline text-slate-500">
                        Sağlayıcı bu mesaj için BCC bilgisini döndürmedi veya boş.
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="inline font-medium text-slate-700">Durum:</dt>{" "}
                    <dd className="inline">{formatMessageState(message.state)}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-slate-700">Yön:</dt>{" "}
                    <dd className="inline">{message.direction === "OUTBOUND" ? "Giden" : "Gelen"}</dd>
                  </div>
                  {message.internetMessageId ? (
                    <div>
                      <dt className="inline font-medium text-slate-700">Message-ID:</dt>{" "}
                      <dd className="inline break-all">{message.internetMessageId}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>

              <div className="mt-3">
                <MailMessageBody bodyText={message.bodyText ?? message.snippet ?? null} bodyHtml={message.bodyHtml} />
              </div>
              {message.attachments.length > 0 ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-700">Ekler</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {message.attachments.map((attachment) => (
                      <li key={attachment.id} className="flex items-center justify-between gap-3">
                        <span className="truncate">
                          {attachment.fileName} ({Math.ceil(Number(attachment.sizeBytes) / 1024)} KB)
                        </span>
                        {attachment.downloadUrl ? (
                          <a
                            href={attachment.downloadUrl}
                            className="rounded border border-slate-300 px-2 py-1 text-[11px] font-medium hover:bg-slate-100"
                          >
                            İndir
                          </a>
                        ) : (
                          <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                            {attachment.virusScanStatus === "PENDING"
                              ? "Tarama bekleniyor"
                              : attachment.virusScanStatus === "INFECTED"
                                ? "Karantinada"
                                : "İndirilemez"}
                          </span>
                        )}
                    </li>
                  ))}
                  </ul>
                </div>
              ) : null}
              {message.labels.length > 0 ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-medium text-slate-700">Etiketler</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {message.labels.map((label) => (
                      <span
                        key={label.id}
                        className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600"
                      >
                        {label.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <div className="space-y-4">
        <MailThreadCalendarPanel
          threadSubject={thread.subject}
          latestMessage={
            latestMessage
              ? {
                  subject: latestMessage.subject,
                  bodyText: latestMessage.bodyText,
                  snippet: latestMessage.snippet,
                  fromName: latestMessage.fromName,
                  fromEmail: latestMessage.fromEmail
                }
              : null
          }
        />
        <MailThreadProductivityPanel
          tenantId={tenantId}
          threadId={thread.id}
          initialProductivity={{
            isPinned: thread.productivity?.isPinned ?? false,
            pinnedAt: thread.productivity?.pinnedAt ?? null,
            readLaterAt: thread.productivity?.readLaterAt ?? null,
            reminderAt: thread.productivity?.reminderAt ?? null,
            note: thread.productivity?.note ?? null
          }}
        />
        <AIActionPanel
          tenantSlug={tenantSlug}
          tenantId={tenantId}
          threadId={thread.id}
          {...(latestMessage ? { messageId: latestMessage.id } : {})}
        />
        <MatterLinkPanel
          tenantId={tenantId}
          threadId={thread.id}
          {...(latestMessage ? { sourceMessageId: latestMessage.id } : {})}
          {...(thread.matter === undefined ? {} : { linkedMatter: thread.matter })}
        />
      </div>

      {inlineCompose ? (
        <>
          <div className="fixed inset-0 z-40 bg-[linear-gradient(135deg,rgba(37,99,235,0.14),rgba(249,115,22,0.14),rgba(255,255,255,0.86))] backdrop-blur-[2px]" />
          <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-end p-3 sm:p-5">
            <div className="pointer-events-auto relative w-full max-w-4xl rounded-2xl border border-blue-100 bg-white p-1 shadow-[0_36px_90px_-46px_rgba(37,99,235,0.6)]">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-2xl bg-gradient-to-r from-blue-600 via-blue-500 to-orange-500" />
              <button
                type="button"
                className="absolute right-4 top-4 z-10 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
                onClick={() => setInlineCompose(null)}
              >
                Kapat
              </button>
              <ComposeEditor
                key={composeSessionKey}
                tenantSlug={tenantSlug}
                tenantId={tenantId}
                mailboxOptions={mailboxOptions}
                initialMailboxId={initialMailboxId}
                composeDefaultFont={composeDefaultFont}
                initialDraft={inlineCompose.initialDraft}
                sendContext={{
                  mode: inlineCompose.mode,
                  threadId: thread.id,
                  inReplyToMessageId: inlineCompose.inReplyToMessageId
                }}
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function formatRecipients(recipients: ThreadMessage["recipients"], type: "TO" | "CC" | "BCC"): string {
  const values = recipients
    .filter((recipient) => recipient.type === type)
    .map((recipient) =>
      recipient.name && recipient.name.trim().length > 0
        ? `${recipient.name} <${recipient.email}>`
        : recipient.email
    );

  return values.length > 0 ? values.join(", ") : "-";
}

function buildReplyPrefill(
  sourceMessage: ThreadMessage,
  senderMailboxEmail: string,
  mode: ComposeMode
): InlineComposeState["initialDraft"] {
  const quotedHeader = [
    `Kimden: ${sourceMessage.fromName ?? sourceMessage.fromEmail ?? "-"}`,
    `Tarih: ${formatMessageDate(sourceMessage.sentAt ?? sourceMessage.receivedAt)}`,
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
    const replyTo =
      sourceMessage.fromEmail && sourceMessage.fromEmail.trim().toLowerCase() !== senderLower
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

function formatMessageDate(value: Date | null): string {
  if (!value) {
    return "Tarih yok";
  }
  return new Date(value).toLocaleString("tr-TR");
}

function formatMessageState(
  state: "RECEIVED" | "SENT" | "DRAFT" | "SCHEDULED" | "ARCHIVED" | "TRASH" | "SPAM"
): string {
  if (state === "RECEIVED") {
    return "Gelen Kutusu";
  }
  if (state === "SENT") {
    return "Gönderildi";
  }
  if (state === "DRAFT") {
    return "Taslak";
  }
  if (state === "SCHEDULED") {
    return "Zamanlandı";
  }
  if (state === "ARCHIVED") {
    return "Arşiv";
  }
  if (state === "TRASH") {
    return "Çöp";
  }
  return "Spam";
}

function isFollowUpLabelName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "takip" || normalized === "follow-up" || normalized === "follow up";
}
