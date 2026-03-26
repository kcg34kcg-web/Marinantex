import { AIActionPanel } from "@/components/ai/ai-action-panel";
import { MailThreadUtilityActions } from "./mail-thread-utility-actions";
import { MailMessageBody } from "./mail-message-body";
import { MailThreadActions } from "./mail-thread-actions";
import { MatterLinkPanel } from "./matter-link-panel";

type ThreadMessage = {
  id: string;
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
};

export function MailThreadView({
  tenantSlug,
  tenantId,
  thread
}: {
  tenantSlug: string;
  tenantId: string;
  thread: {
    id: string;
    subject: string | null;
    matter?: {
      id: string;
      title: string;
      referenceNo: string | null;
    } | null;
    messages: ThreadMessage[];
  };
}) {
  const latestMessage = thread.messages[thread.messages.length - 1];

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
                latestMessageId={latestMessage?.id ?? null}
                latestMessageState={latestMessage?.state ?? null}
              />
            </div>
          </div>
        </header>

        <div className="divide-y divide-slate-100">
          {thread.messages.map((message) => (
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
            </article>
          ))}
        </div>
      </section>

      <div className="space-y-4">
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
