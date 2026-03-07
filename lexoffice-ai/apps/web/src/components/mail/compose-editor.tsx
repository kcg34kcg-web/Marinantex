"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AttachmentUploader } from "./attachment-uploader";
import { RecipientChips } from "./recipient-chips";

export function ComposeEditor({ tenantId, mailboxId }: { tenantId: string; mailboxId: string }) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const skipAutosaveRef = useRef(true);

  const recipientList = useMemo(() => {
    return to
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }, [to]);

  async function autosave(silent = false): Promise<void> {
    if (recipientList.length === 0 && subject.trim().length === 0 && bodyText.trim().length === 0) {
      if (!silent) {
        setStatus("Kaydedilecek içerik bulunamadı");
      }
      return;
    }

    setIsSaving(true);
    if (!silent) {
      setStatus("Kaydediliyor...");
    }

    const response = await fetch("/api/v1/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(draftId ? { draftId } : {}),
        tenantId,
        mailboxId,
        subject,
        bodyText,
        toRecipients: recipientList
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: { draft?: { id: string } };
      error?: { message: string };
    };

    if (payload.ok) {
      if (payload.data?.draft?.id) {
        setDraftId(payload.data.draft.id);
      }
      setStatus(silent ? "Taslak otomatik kaydedildi" : "Taslak kaydedildi");
      setIsSaving(false);
      return;
    }

    setStatus(payload.error?.message ?? "Taslak kaydı başarısız");
    setIsSaving(false);
  }

  useEffect(() => {
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }

    const hasContent =
      recipientList.length > 0 || subject.trim().length > 0 || bodyText.trim().length > 0;
    if (!hasContent || isSending) {
      return;
    }

    const timer = window.setTimeout(() => {
      void autosave(true);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [recipientList, subject, bodyText, isSending]);

  async function send(): Promise<void> {
    if (recipientList.length === 0) {
      setStatus("En az bir alıcı girin");
      return;
    }

    setIsSending(true);
    setSendError(null);
    setStatus("Gönderiliyor...");

    const encodedAttachments = await Promise.all(
      attachments.map(async (file) => ({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64: await fileToBase64(file)
      }))
    );

    const response = await fetch("/api/v1/mail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        mailboxId,
        subject,
        bodyText,
        toRecipients: recipientList,
        ccRecipients: [],
        bccRecipients: [],
        attachments: encodedAttachments
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: { threadId: string };
      error?: { message: string };
    };

    if (!payload.ok || !payload.data) {
      const errorMessage = payload.error?.message ?? "Mail gönderimi başarısız";
      setStatus(errorMessage);
      setSendError(errorMessage);
      setIsSending(false);
      return;
    }

    setStatus("Mail gönderildi");
    setDraftId(null);
    setTo("");
    setSubject("");
    setBodyText("");
    setAttachments([]);
    setIsSending(false);

    router.push(`../${payload.data.threadId}`);
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold">Yeni Mail</h2>
      {sendError ? (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <p>Gönderim başarısız: {sendError}</p>
          <button
            type="button"
            className="mt-2 rounded border border-rose-300 px-2 py-1"
            onClick={() => {
              void send();
            }}
          >
            Tekrar Dene
          </button>
        </div>
      ) : null}
      <input
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        placeholder="Kime"
        value={to}
        onChange={(event) => setTo(event.target.value)}
      />
      {recipientList.length > 0 ? <RecipientChips emails={recipientList} /> : null}
      <input
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        placeholder="Konu"
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
      />
      <textarea
        className="min-h-[220px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        placeholder="Mesaj"
        value={bodyText}
        onChange={(event) => setBodyText(event.target.value)}
      />
      <AttachmentUploader
        onSelect={(files) => {
          setAttachments(files);
          setStatus(files.length > 0 ? `${files.length} dosya seçildi` : "Dosya seçimi temizlendi");
        }}
      />
      {attachments.length > 0 ? (
        <ul className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {attachments.map((file) => (
            <li key={`${file.name}-${file.size}`} className="truncate">
              {file.name} ({Math.ceil(file.size / 1024)} KB)
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center justify-between">
        <button
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          type="button"
          disabled={isSaving || isSending}
          onClick={() => {
            void autosave(false);
          }}
        >
          {isSaving ? "Kaydediliyor..." : "Taslak Kaydet"}
        </button>
        <button
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          type="button"
          disabled={isSaving || isSending}
          onClick={() => {
            void send();
          }}
        >
          {isSending ? "Gönderiliyor..." : "Gönder"}
        </button>
      </div>
      {status ? <p className="text-xs text-slate-600">{status}</p> : null}
    </section>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(arrayBuffer);

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
