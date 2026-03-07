import { AIActionPanel } from "@/components/ai/ai-action-panel";
import { MatterLinkPanel } from "./matter-link-panel";

type ThreadMessage = {
  id: string;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  bodyText: string | null;
  snippet: string | null;
  isRead: boolean;
  receivedAt: Date | null;
};

export function MailThreadView({
  tenantId,
  thread
}: {
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
          <h2 className="text-base font-semibold text-slate-900">{thread.subject ?? "(Konu yok)"}</h2>
        </header>

        <div className="divide-y divide-slate-100">
          {thread.messages.map((message) => (
            <article key={message.id} className="px-4 py-4">
              <p className="text-sm font-medium text-slate-900">{message.fromName ?? message.fromEmail ?? "Gönderen"}</p>
              <p className="mt-1 text-xs text-slate-500">
                {message.receivedAt ? new Date(message.receivedAt).toLocaleString("tr-TR") : "Tarih yok"}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{message.bodyText ?? message.snippet ?? "İçerik yok"}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="space-y-4">
        <AIActionPanel
          tenantId={tenantId}
          threadId={thread.id}
          {...(latestMessage ? { messageId: latestMessage.id } : {})}
        />
        <MatterLinkPanel
          tenantId={tenantId}
          threadId={thread.id}
          {...(thread.matter === undefined ? {} : { linkedMatter: thread.matter })}
        />
      </div>
    </div>
  );
}
