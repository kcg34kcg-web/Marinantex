"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { AttachmentUploader } from "./attachment-uploader";
import { RecipientChips } from "./recipient-chips";

type StagedAttachment = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  attachmentToken: string;
};

type ComposeMode = "plain" | "rich";

const MAX_ATTACHMENT_COUNT = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const LARGE_ATTACHMENT_WARNING_BYTES = 20 * 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

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

type ComposeTemplate = {
  id: string;
  name: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
};

type TemplateUsageRecord = {
  count: number;
  lastUsedAt: number;
};

type ScheduleSuggestion = {
  id: string;
  label: string;
  value: Date;
};

const COMPOSE_TEMPLATES: ComposeTemplate[] = [
  {
    id: "professional-followup",
    name: "Profesyonel Takip",
    subject: "Konu hakkında bilgilendirme",
    bodyText:
      "Merhaba,\n\nMesajınızı aldık. Konuyu ekip içinde değerlendirip size en kısa sürede net bir geri dönüş ileteceğiz.\n\nSaygılarımızla,"
  },
  {
    id: "meeting-confirmation",
    name: "Toplantı Teyidi",
    subject: "Toplantı teyidi",
    bodyText:
      "Merhaba,\n\nPlanlanan toplantıyı teyit ediyoruz. Uygun görürseniz kısa gündem maddelerini bu maile yanıt olarak paylaşabilirsiniz.\n\nTeşekkürler,"
  },
  {
    id: "document-request",
    name: "Belge Talebi",
    subject: "Ek belge talebi",
    bodyText:
      "Merhaba,\n\nDosya incelemesini tamamlayabilmemiz için ilgili belgeleri bu e-postaya ek olarak iletmenizi rica ederiz.\n\nİyi çalışmalar,"
  }
];

const TEMPLATE_USAGE_STORAGE_KEY = "lexoffice.mail.template-usage.v1";

type InitialDraft = {
  id?: string;
  subject: string;
  bodyText: string;
  toRecipients: string[];
  ccRecipients: string[];
  bccRecipients: string[];
};

type SendContext = {
  mode: "reply" | "reply-all" | "forward";
  threadId?: string;
  inReplyToMessageId?: string;
};

type RecipientSuggestion = {
  email: string;
  name: string | null;
  source: "recent" | "contact" | "client";
  lastUsedAt: string | null;
};

export function ComposeEditor({
  tenantSlug,
  tenantId,
  mailboxOptions,
  initialMailboxId,
  composeDefaultFont,
  signatures = [],
  initialDraft,
  sendContext
}: {
  tenantSlug: string;
  tenantId: string;
  mailboxOptions: ComposeMailboxOption[];
  initialMailboxId: string;
  composeDefaultFont: ComposeFont;
  signatures?: ComposeSignature[];
  initialDraft?: InitialDraft;
  sendContext?: SendContext;
}) {
  const router = useRouter();
  const mailboxSelectionLocked = Boolean(sendContext);
  const [to, setTo] = useState((initialDraft?.toRecipients ?? []).join(", "));
  const [cc, setCc] = useState((initialDraft?.ccRecipients ?? []).join(", "));
  const [bcc, setBcc] = useState((initialDraft?.bccRecipients ?? []).join(", "));
  const [showCcBcc, setShowCcBcc] = useState(
    (initialDraft?.ccRecipients.length ?? 0) > 0 || (initialDraft?.bccRecipients.length ?? 0) > 0
  );
  const [subject, setSubject] = useState(initialDraft?.subject ?? "");
  const [bodyText, setBodyText] = useState(initialDraft?.bodyText ?? "");
  const [bodyHtml, setBodyHtml] = useState("");
  const [mode, setMode] = useState<ComposeMode>("plain");
  const [selectedMailboxId, setSelectedMailboxId] = useState(initialMailboxId);
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [selectedSignatureId, setSelectedSignatureId] = useState(
    () => signatures.find((signature) => signature.isDefault)?.id ?? signatures[0]?.id ?? ""
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateUsage, setTemplateUsage] = useState<Record<string, TemplateUsageRecord>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recipientSuggestions, setRecipientSuggestions] = useState<RecipientSuggestion[]>([]);
  const [activeRecipientField, setActiveRecipientField] = useState<"to" | "cc" | "bcc" | null>(null);
  const [scheduledAtLocal, setScheduledAtLocal] = useState(() =>
    toDateTimeLocalValue(new Date(Date.now() + 30 * 60 * 1000))
  );
  const [scheduleSuggestions, setScheduleSuggestions] = useState<ScheduleSuggestion[]>([]);
  const [undoScheduledDraftId, setUndoScheduledDraftId] = useState<string | null>(null);
  const [undoDeadlineAt, setUndoDeadlineAt] = useState<number | null>(null);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);
  const skipAutosaveRef = useRef(true);
  const lastMailboxIdRef = useRef(initialMailboxId);
  const richEditorRef = useRef<HTMLDivElement>(null);
  const inlineImageInputRef = useRef<HTMLInputElement>(null);
  const composeFontFamily = useMemo(
    () => resolveComposeFontFamily(composeDefaultFont),
    [composeDefaultFont]
  );
  const activeMailbox =
    mailboxOptions.find((mailbox) => mailbox.id === selectedMailboxId) ?? mailboxOptions[0] ?? null;
  const activeMailboxId = activeMailbox?.id ?? "";

  const toRecipients = useMemo(() => parseRecipients(to), [to]);
  const ccRecipients = useMemo(() => parseRecipients(cc), [cc]);
  const bccRecipients = useMemo(() => parseRecipients(bcc), [bcc]);
  const totalAttachmentBytes = useMemo(
    () => attachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0),
    [attachments]
  );
  const attachmentMentioned = useMemo(
    () => detectAttachmentMention([subject, bodyText].join("\n")),
    [bodyText, subject]
  );
  const toSuggestionItems = useMemo(
    () => buildSuggestionsForField(to, toRecipients, recipientSuggestions),
    [recipientSuggestions, to, toRecipients]
  );
  const ccSuggestionItems = useMemo(
    () => buildSuggestionsForField(cc, ccRecipients, recipientSuggestions),
    [cc, ccRecipients, recipientSuggestions]
  );
  const bccSuggestionItems = useMemo(
    () => buildSuggestionsForField(bcc, bccRecipients, recipientSuggestions),
    [bcc, bccRecipients, recipientSuggestions]
  );
  const quickRecentRecipients = useMemo(
    () =>
      recipientSuggestions
        .filter((item) => item.lastUsedAt)
        .slice(0, 6)
        .filter((item, index, list) => list.findIndex((entry) => entry.email === item.email) === index),
    [recipientSuggestions]
  );
  const sortedTemplates = useMemo(() => {
    return [...COMPOSE_TEMPLATES].sort((left, right) => {
      const leftUsage = templateUsage[left.id]?.count ?? 0;
      const rightUsage = templateUsage[right.id]?.count ?? 0;
      if (leftUsage !== rightUsage) {
        return rightUsage - leftUsage;
      }
      return left.name.localeCompare(right.name, "tr", { sensitivity: "base" });
    });
  }, [templateUsage]);
  const frequentTemplates = useMemo(
    () => sortedTemplates.filter((template) => (templateUsage[template.id]?.count ?? 0) > 0).slice(0, 3),
    [sortedTemplates, templateUsage]
  );

  useEffect(() => {
    if (!initialDraft) {
      return;
    }

    setDraftId(initialDraft.id ?? null);
    setTo(initialDraft.toRecipients.join(", "));
    setCc(initialDraft.ccRecipients.join(", "));
    setBcc(initialDraft.bccRecipients.join(", "));
    setSubject(initialDraft.subject);
    setBodyText(initialDraft.bodyText);
    setBodyHtml("");
    setShowCcBcc(initialDraft.ccRecipients.length > 0 || initialDraft.bccRecipients.length > 0);
  }, [initialDraft]);

  useEffect(() => {
    if (!undoDeadlineAt) {
      setUndoSecondsLeft(0);
      return;
    }

    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((undoDeadlineAt - Date.now()) / 1000));
      setUndoSecondsLeft(seconds);
      if (seconds <= 0) {
        setUndoScheduledDraftId(null);
        setUndoDeadlineAt(null);
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [undoDeadlineAt]);

  useEffect(() => {
    let cancelled = false;

    async function loadRecipientSuggestions(): Promise<void> {
      try {
        const params = new URLSearchParams({
          tenantId,
          limit: "40"
        });
        const response = await fetch(
          withBasePath(`/api/v1/mail/recipients/suggestions?${params.toString()}`),
          {
            method: "GET",
            cache: "no-store"
          }
        );

        const payload = (await response.json()) as {
          ok: boolean;
          data?: { suggestions?: RecipientSuggestion[] };
          error?: { message: string };
        };

        if (!response.ok || !payload.ok || !payload.data?.suggestions) {
          return;
        }

        if (!cancelled) {
          setRecipientSuggestions(payload.data.suggestions);
        }
      } catch {
        return;
      }
    }

    void loadRecipientSuggestions();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    const firstMailbox = mailboxOptions[0];
    if (!firstMailbox) {
      return;
    }

    if (!mailboxOptions.some((mailbox) => mailbox.id === selectedMailboxId)) {
      setSelectedMailboxId(firstMailbox.id);
    }
  }, [mailboxOptions, selectedMailboxId]);

  useEffect(() => {
    if (!activeMailboxId || lastMailboxIdRef.current === activeMailboxId) {
      return;
    }

    lastMailboxIdRef.current = activeMailboxId;
    if (attachments.length > 0) {
      setAttachments([]);
      setStatus("Gönderici hesabı değiştiği için ekler temizlendi.");
    }
  }, [activeMailboxId, attachments.length]);

  useEffect(() => {
    if (signatures.length === 0) {
      setSelectedSignatureId("");
      return;
    }

    if (!selectedSignatureId || !signatures.some((signature) => signature.id === selectedSignatureId)) {
      setSelectedSignatureId(
        signatures.find((signature) => signature.isDefault)?.id ?? signatures[0]?.id ?? ""
      );
    }
  }, [selectedSignatureId, signatures]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(TEMPLATE_USAGE_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, TemplateUsageRecord>;
      if (!parsed || typeof parsed !== "object") {
        return;
      }
      setTemplateUsage(parsed);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    setScheduleSuggestions(buildScheduleSuggestions(new Date()));
  }, []);

  async function autosave(silent = false): Promise<void> {
    if (!activeMailboxId) {
      setStatus("Taslak kaydı için gönderici hesabı seçilemedi");
      return;
    }

    const richText = richEditorRef.current?.innerText ?? "";
    const draftBody = mode === "rich" ? richText : bodyText;

    if (
      toRecipients.length === 0 &&
      ccRecipients.length === 0 &&
      bccRecipients.length === 0 &&
      subject.trim().length === 0 &&
      draftBody.trim().length === 0
    ) {
      if (!silent) {
        setStatus("Kaydedilecek içerik bulunamadı");
      }
      return;
    }

    setIsSaving(true);
    if (!silent) {
      setStatus("Kaydediliyor...");
    }

    const response = await fetch(withBasePath("/api/v1/drafts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(draftId ? { draftId } : {}),
        tenantId,
        mailboxId: activeMailboxId,
        subject,
        bodyText: draftBody,
        toRecipients,
        ccRecipients,
        bccRecipients
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
      toRecipients.length > 0 ||
      ccRecipients.length > 0 ||
      bccRecipients.length > 0 ||
      subject.trim().length > 0 ||
      bodyText.trim().length > 0;
    if (!hasContent || isSending) {
      return;
    }

    const timer = window.setTimeout(() => {
      void autosave(true);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [toRecipients, ccRecipients, bccRecipients, subject, bodyText, isSending]);

  useEffect(() => {
    if (mode !== "rich" || !richEditorRef.current) {
      return;
    }

    const html = bodyHtml.trim().length > 0 ? bodyHtml : plainTextToHtml(bodyText);
    richEditorRef.current.innerHTML = html;
  }, [mode]);

  function syncRichContent(editor: HTMLDivElement): void {
    setBodyHtml(editor.innerHTML);
    setBodyText(editor.innerText);
  }

  function execRichCommand(command: string, value?: string): void {
    if (mode !== "rich") {
      return;
    }

    richEditorRef.current?.focus();
    document.execCommand(command, false, value);
    if (richEditorRef.current) {
      syncRichContent(richEditorRef.current);
    }
  }

  async function insertInlineImage(file: File): Promise<void> {
    if (mode !== "rich") {
      setStatus("Inline resim eklemek için önce Zengin Metin moduna geçin.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      setStatus("Sadece görsel dosyaları inline eklenebilir.");
      return;
    }

    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      setStatus(`Inline görsel limiti ${formatBytes(MAX_INLINE_IMAGE_BYTES)}.`);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      execRichCommand("insertImage", dataUrl);
      setStatus(`Inline görsel eklendi: ${file.name}`);
    } catch {
      setStatus("Inline görsel eklenemedi.");
    }
  }

  function markTemplateUsage(templateId: string): void {
    setTemplateUsage((previous) => {
      const nextEntry: TemplateUsageRecord = {
        count: (previous[templateId]?.count ?? 0) + 1,
        lastUsedAt: Date.now()
      };
      const next = {
        ...previous,
        [templateId]: nextEntry
      };

      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(TEMPLATE_USAGE_STORAGE_KEY, JSON.stringify(next));
        } catch {
          return next;
        }
      }

      return next;
    });
  }

  function applyTemplate(templateId: string = selectedTemplateId): void {
    const template = COMPOSE_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) {
      return;
    }

    const hasExistingDraft = subject.trim().length > 0 || bodyText.trim().length > 0;
    if (hasExistingDraft) {
      const shouldReplace = window.confirm("Şablon mevcut konu/metni değiştirecek. Devam edilsin mi?");
      if (!shouldReplace) {
        return;
      }
    }

    setSubject(template.subject);
    setBodyText(template.bodyText);

    const templateHtml = template.bodyHtml ?? plainTextToHtml(template.bodyText);
    setBodyHtml(templateHtml);

    if (mode === "rich" && richEditorRef.current) {
      richEditorRef.current.innerHTML = templateHtml;
      syncRichContent(richEditorRef.current);
    }

    markTemplateUsage(template.id);
    setSelectedTemplateId(template.id);
    setStatus(`Şablon uygulandı: ${template.name}`);
  }

  function appendSignature(): void {
    if (!selectedSignatureId) {
      setStatus("Önce bir imza seçin.");
      return;
    }

    const signature = signatures.find((entry) => entry.id === selectedSignatureId);
    if (!signature) {
      setStatus("Seçilen imza bulunamadı.");
      return;
    }

    if (mode === "rich") {
      const signatureHtml =
        signature.htmlBody.trim().length > 0
          ? signature.htmlBody
          : plainTextToHtml(signature.textBody ?? "");
      const currentHtml = richEditorRef.current?.innerHTML ?? bodyHtml;
      const nextHtml =
        currentHtml.trim().length > 0 ? `${currentHtml}<br/><br/>${signatureHtml}` : signatureHtml;
      setBodyHtml(nextHtml);
      if (richEditorRef.current) {
        richEditorRef.current.innerHTML = nextHtml;
        syncRichContent(richEditorRef.current);
      } else {
        setBodyText(stripHtmlToText(nextHtml));
      }
    } else {
      const signatureText =
        signature.textBody?.trim().length
          ? signature.textBody
          : stripHtmlToText(signature.htmlBody).trim();
      setBodyText((current) =>
        current.trim().length > 0 ? `${current}\n\n${signatureText}` : signatureText
      );
    }

    setStatus(`İmza eklendi: ${signature.name}`);
  }

  async function createSignatureFromCurrentContent(): Promise<void> {
    const suggestedName = window.prompt("Yeni imza adı");
    if (!suggestedName || suggestedName.trim().length === 0) {
      return;
    }

    const signatureHtml =
      mode === "rich" ? (richEditorRef.current?.innerHTML ?? bodyHtml) : plainTextToHtml(bodyText);
    const signatureText =
      mode === "rich" ? (richEditorRef.current?.innerText ?? bodyText) : bodyText;

    if (signatureHtml.trim().length === 0 && signatureText.trim().length === 0) {
      setStatus("Boş içerikten imza oluşturulamaz.");
      return;
    }

    const response = await fetch(withBasePath("/api/v1/mail/signatures"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId,
        name: suggestedName.trim(),
        htmlBody: signatureHtml,
        textBody: signatureText,
        isDefault: signatures.length === 0
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: {
        signature?: {
          id: string;
          name: string;
        };
      };
      error?: {
        message: string;
      };
    };

    if (!payload.ok) {
      setStatus(payload.error?.message ?? "İmza oluşturulamadı.");
      return;
    }

    if (payload.data?.signature?.id) {
      setSelectedSignatureId(payload.data.signature.id);
    }
    setStatus(`İmza kaydedildi: ${payload.data?.signature?.name ?? suggestedName.trim()}`);
    router.refresh();
  }

  function switchMode(nextMode: ComposeMode): void {
    if (nextMode === mode) {
      return;
    }

    if (nextMode === "rich") {
      const html = bodyHtml.trim().length > 0 ? bodyHtml : plainTextToHtml(bodyText);
      setBodyHtml(html);
      setMode(nextMode);
      window.setTimeout(() => {
        if (richEditorRef.current) {
          richEditorRef.current.innerHTML = html;
          richEditorRef.current.focus();
        }
      }, 0);
      return;
    }

    if (richEditorRef.current) {
      syncRichContent(richEditorRef.current);
    }

    setMode(nextMode);
  }

  function applyRecipientSuggestion(field: "to" | "cc" | "bcc", email: string): void {
    if (field === "to") {
      setTo((current) => replaceCurrentRecipientToken(current, email));
      return;
    }

    if (field === "cc") {
      setCc((current) => replaceCurrentRecipientToken(current, email));
      return;
    }

    setBcc((current) => replaceCurrentRecipientToken(current, email));
  }

  async function stageFiles(files: File[]): Promise<void> {
    if (!activeMailboxId) {
      setStatus("Dosya yüklemek için geçerli bir mailbox seçilmeli");
      return;
    }

    if (files.length === 0) {
      setAttachments([]);
      setStatus("Dosya seçimi temizlendi");
      return;
    }

    if (files.length > MAX_ATTACHMENT_COUNT) {
      setStatus(`En fazla ${MAX_ATTACHMENT_COUNT} dosya eklenebilir. İlk ${MAX_ATTACHMENT_COUNT} dosya alındı.`);
    }

    const limitedFiles = files.slice(0, MAX_ATTACHMENT_COUNT);
    const oversizedFiles = limitedFiles.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (oversizedFiles.length > 0) {
      setStatus(
        `${oversizedFiles.map((file) => file.name).join(", ")} dosyası 25MB sınırını aşıyor.`
      );
      return;
    }

    setIsUploading(true);
    setStatus("Dosyalar güvenli yükleniyor...");

    try {
      const staged: StagedAttachment[] = [];

      for (const file of limitedFiles) {
        const mimeType = file.type || "application/octet-stream";

        const initResponse = await fetch(withBasePath("/api/v1/attachments/staging-url"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            tenantId,
            mailboxId: activeMailboxId,
            fileName: file.name,
            mimeType,
            sizeBytes: file.size
          })
        });

        const initPayload = (await initResponse.json()) as {
          ok: boolean;
          data?: {
            uploadUrl: string;
            uploadMethod?: "PUT";
            uploadHeaders?: Record<string, string>;
            attachmentToken: string;
          };
          error?: {
            message: string;
          };
        };

        if (!initResponse.ok || !initPayload.ok || !initPayload.data) {
          throw new Error(initPayload.error?.message ?? "Attachment upload URL alınamadı");
        }

        const uploadMethod = initPayload.data.uploadMethod ?? "PUT";
        const uploadHeaders = initPayload.data.uploadHeaders ?? {
          "Content-Type": mimeType
        };

        const uploadResponse = await fetch(initPayload.data.uploadUrl, {
          method: uploadMethod,
          headers: uploadHeaders,
          body: file
        });

        if (!uploadResponse.ok) {
          const responseType = uploadResponse.headers.get("content-type") ?? "";

          if (responseType.includes("application/json")) {
            const uploadPayload = (await uploadResponse.json()) as {
              ok: boolean;
              error?: {
                message: string;
              };
            };

            throw new Error(uploadPayload.error?.message ?? "Attachment yükleme başarısız");
          }

          const errorText = (await uploadResponse.text()).slice(0, 240);
          throw new Error(errorText.length > 0 ? errorText : "Attachment yükleme başarısız");
        }

        const responseType = uploadResponse.headers.get("content-type") ?? "";
        if (responseType.includes("application/json")) {
          const uploadPayload = (await uploadResponse.json()) as {
            ok: boolean;
            error?: {
              message: string;
            };
          };

          if (!uploadPayload.ok) {
            throw new Error(uploadPayload.error?.message ?? "Attachment yükleme başarısız");
          }
        }

        staged.push({
          name: file.name,
          mimeType,
          sizeBytes: file.size,
          attachmentToken: initPayload.data.attachmentToken
        });
      }

      setAttachments(staged);
      const stagedSize = staged.reduce((sum, item) => sum + item.sizeBytes, 0);
      if (stagedSize > LARGE_ATTACHMENT_WARNING_BYTES) {
        setStatus(
          `${staged.length} dosya yüklendi. Toplam boyut ${formatBytes(stagedSize)}; bazı sağlayıcılarda gönderim sınırı aşılabilir.`
        );
      } else {
        setStatus(`${staged.length} dosya güvenli olarak yüklendi`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dosya yükleme başarısız";
      setStatus(message);
      setAttachments([]);
    } finally {
      setIsUploading(false);
    }
  }

  async function send(): Promise<void> {
    if (!activeMailboxId) {
      setStatus("Gönderim için geçerli bir mailbox bulunamadı");
      return;
    }

    const rawHtmlBody =
      mode === "rich" ? richEditorRef.current?.innerHTML ?? bodyHtml : bodyHtml;
    const htmlBody =
      mode === "rich" ? wrapHtmlWithFont(rawHtmlBody, composeFontFamily) : rawHtmlBody;
    const textBody = mode === "rich" ? richEditorRef.current?.innerText ?? bodyText : bodyText;

    if (toRecipients.length === 0) {
      setStatus("En az bir alıcı girin");
      return;
    }

    if (subject.trim().length === 0) {
      const proceedWithoutSubject = window.confirm(
        "Konu alanı boş. Konu olmadan göndermek istediğinize emin misiniz?"
      );
      if (!proceedWithoutSubject) {
        return;
      }
    }

    if (attachmentMentioned && attachments.length === 0) {
      const proceedWithoutAttachment = window.confirm(
        "Mesaj içinde ek ifadesi geçiyor ancak dosya eklenmemiş. Yine de gönderilsin mi?"
      );
      if (!proceedWithoutAttachment) {
        return;
      }
    }

    if (totalAttachmentBytes > LARGE_ATTACHMENT_WARNING_BYTES) {
      const proceedLargeAttachment = window.confirm(
        `Toplam ek boyutu ${formatBytes(totalAttachmentBytes)}. Bazı sağlayıcılarda gönderim reddedilebilir. Devam edilsin mi?`
      );
      if (!proceedLargeAttachment) {
        return;
      }
    }

    setIsSending(true);
    setSendError(null);
    setStatus("Gönderiliyor...");

    const payloadBody: {
      tenantId: string;
      mailboxId: string;
      threadId?: string;
      inReplyToMessageId?: string;
      subject: string;
      bodyText: string;
      bodyHtml?: string;
      toRecipients: string[];
      ccRecipients: string[];
      bccRecipients: string[];
      attachments: Array<{
        kind: "staged";
        attachmentToken: string;
        name: string;
        mimeType: string;
        sizeBytes: number;
      }>;
    } = {
      tenantId,
      mailboxId: activeMailboxId,
      subject,
      bodyText: textBody,
      toRecipients,
      ccRecipients,
      bccRecipients,
      attachments: attachments.map((attachment) => ({
        kind: "staged",
        attachmentToken: attachment.attachmentToken,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes
      }))
    };

    if (mode === "rich" && htmlBody.trim().length > 0) {
      payloadBody.bodyHtml = htmlBody;
    }

    if (sendContext?.threadId) {
      payloadBody.threadId = sendContext.threadId;
    }

    if (sendContext?.inReplyToMessageId) {
      payloadBody.inReplyToMessageId = sendContext.inReplyToMessageId;
    }

    const response = await fetch(withBasePath("/api/v1/mail/send"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadBody)
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
    setCc("");
    setBcc("");
    setSubject("");
    setBodyText("");
    setBodyHtml("");
    setAttachments([]);
    if (richEditorRef.current) {
      richEditorRef.current.innerHTML = "";
    }
    setIsSending(false);

    router.push(`/${tenantSlug}/mail/${payload.data.threadId}`);
    router.refresh();
  }

  async function scheduleSend({
    scheduledAtIso,
    undoWindowSeconds
  }: {
    scheduledAtIso: string;
    undoWindowSeconds?: number;
  }): Promise<void> {
    if (!activeMailboxId) {
      setStatus("Zamanlama için geçerli bir mailbox bulunamadı");
      return;
    }

    const rawHtmlBody =
      mode === "rich" ? richEditorRef.current?.innerHTML ?? bodyHtml : bodyHtml;
    const htmlBody =
      mode === "rich" ? wrapHtmlWithFont(rawHtmlBody, composeFontFamily) : rawHtmlBody;
    const textBody = mode === "rich" ? richEditorRef.current?.innerText ?? bodyText : bodyText;

    if (toRecipients.length === 0) {
      setStatus("En az bir alıcı girin");
      return;
    }

    const scheduledAt = new Date(scheduledAtIso);
    if (Number.isNaN(scheduledAt.getTime())) {
      setStatus("Geçerli bir zaman seçin");
      return;
    }

    if (scheduledAt.getTime() <= Date.now() + 5_000) {
      setStatus("Zamanlama en az 5 saniye ileride olmalı");
      return;
    }

    setIsScheduling(true);
    setSendError(null);
    setStatus("Gönderim zamanlanıyor...");

    const payloadBody: {
      tenantId: string;
      mailboxId: string;
      threadId?: string;
      inReplyToMessageId?: string;
      subject: string;
      bodyText: string;
      bodyHtml?: string;
      toRecipients: string[];
      ccRecipients: string[];
      bccRecipients: string[];
      attachments: Array<{
        kind: "staged";
        attachmentToken: string;
        name: string;
        mimeType: string;
        sizeBytes: number;
      }>;
      scheduledAt: string;
      undoWindowSeconds?: number;
    } = {
      tenantId,
      mailboxId: activeMailboxId,
      subject,
      bodyText: textBody,
      toRecipients,
      ccRecipients,
      bccRecipients,
      attachments: attachments.map((attachment) => ({
        kind: "staged",
        attachmentToken: attachment.attachmentToken,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes
      })),
      scheduledAt: scheduledAt.toISOString()
    };

    if (mode === "rich" && htmlBody.trim().length > 0) {
      payloadBody.bodyHtml = htmlBody;
    }

    if (sendContext?.threadId) {
      payloadBody.threadId = sendContext.threadId;
    }

    if (sendContext?.inReplyToMessageId) {
      payloadBody.inReplyToMessageId = sendContext.inReplyToMessageId;
    }

    if (undoWindowSeconds !== undefined) {
      payloadBody.undoWindowSeconds = undoWindowSeconds;
    }

    const response = await fetch(withBasePath("/api/v1/mail/send/schedule"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadBody)
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: {
        scheduledDraftId: string;
        scheduledAt: string;
        correlationId: string;
      };
      error?: { message: string };
    };

    if (!payload.ok || !payload.data) {
      const errorMessage = payload.error?.message ?? "Zamanlanmış gönderim başarısız";
      setStatus(errorMessage);
      setSendError(errorMessage);
      setIsScheduling(false);
      return;
    }

    setStatus(`Mail ${new Date(payload.data.scheduledAt).toLocaleString("tr-TR")} için zamanlandı`);
    setDraftId(payload.data.scheduledDraftId);

    if (undoWindowSeconds !== undefined) {
      setUndoScheduledDraftId(payload.data.scheduledDraftId);
      setUndoDeadlineAt(new Date(payload.data.scheduledAt).getTime());
    }

    setIsScheduling(false);
  }

  async function undoScheduledSend(): Promise<void> {
    if (!undoScheduledDraftId) {
      return;
    }

    const response = await fetch(
      withBasePath(`/api/v1/mail/send/scheduled/${encodeURIComponent(undoScheduledDraftId)}/cancel`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId
        })
      }
    );

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setStatus(payload.error?.message ?? "Geri alma başarısız");
      return;
    }

    setStatus("Gönderim geri alındı");
    setUndoScheduledDraftId(null);
    setUndoDeadlineAt(null);
    setUndoSecondsLeft(0);
  }

  return (
    <section className="space-y-3 rounded-2xl border border-blue-100 bg-white p-4 shadow-[0_24px_64px_-36px_rgba(37,99,235,0.5)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Yeni Mail</h2>
        <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
          White-Orange-Blue
        </span>
      </div>
      {sendContext ? (
        <p className="text-xs text-slate-500">
          Mod:{" "}
          {sendContext.mode === "reply"
            ? "Yanıtla"
            : sendContext.mode === "reply-all"
              ? "Tümüne Yanıtla"
              : "İlet"}
        </p>
      ) : null}
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
      <label className="block text-xs text-slate-600">
        Gönderen Hesap
        <select
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          value={activeMailboxId}
          disabled={mailboxSelectionLocked || mailboxOptions.length <= 1}
          onChange={(event) => setSelectedMailboxId(event.target.value)}
        >
          {mailboxOptions.map((mailbox) => (
            <option key={mailbox.id} value={mailbox.id}>
              {mailbox.displayName ? `${mailbox.displayName} <${mailbox.email}>` : mailbox.email}
            </option>
          ))}
        </select>
      </label>
      {mailboxSelectionLocked ? (
        <p className="text-xs text-slate-500">
          Yanıt/ilet modunda thread tutarlılığı için gönderen hesap değiştirilemez.
        </p>
      ) : null}
      <div className="space-y-2">
        <input
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          placeholder="Kime"
          value={to}
          onFocus={() => setActiveRecipientField("to")}
          onBlur={() => {
            window.setTimeout(() => setActiveRecipientField((current) => (current === "to" ? null : current)), 120);
          }}
          onChange={(event) => {
            setTo(event.target.value);
            setActiveRecipientField("to");
          }}
        />
        {quickRecentRecipients.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">Son Alıcılar:</span>
            {quickRecentRecipients.map((suggestion) => (
              <button
                key={`quick-${suggestion.email}`}
                type="button"
                className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100"
                onClick={() => applyRecipientSuggestion("to", suggestion.email)}
              >
                {suggestion.name ? `${suggestion.name} <${suggestion.email}>` : suggestion.email}
              </button>
            ))}
          </div>
        ) : null}
        {activeRecipientField === "to" ? (
          <RecipientSuggestionList
            suggestions={toSuggestionItems}
            onPick={(email) => applyRecipientSuggestion("to", email)}
          />
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-2">
        {toRecipients.length > 0 ? <RecipientChips emails={toRecipients} /> : <div />}
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-xs"
          onClick={() => setShowCcBcc((current) => !current)}
        >
          {showCcBcc ? "CC/BCC Gizle" : "CC/BCC Göster"}
        </button>
      </div>
      {(showCcBcc || ccRecipients.length > 0 || bccRecipients.length > 0) ? (
        <div className="space-y-2">
          <div className="space-y-1">
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="CC"
              value={cc}
              onFocus={() => setActiveRecipientField("cc")}
              onBlur={() => {
                window.setTimeout(() => setActiveRecipientField((current) => (current === "cc" ? null : current)), 120);
              }}
              onChange={(event) => {
                setCc(event.target.value);
                setActiveRecipientField("cc");
              }}
            />
            {activeRecipientField === "cc" ? (
              <RecipientSuggestionList
                suggestions={ccSuggestionItems}
                onPick={(email) => applyRecipientSuggestion("cc", email)}
              />
            ) : null}
          </div>
          {ccRecipients.length > 0 ? <RecipientChips emails={ccRecipients} /> : null}
          <div className="space-y-1">
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="BCC"
              value={bcc}
              onFocus={() => setActiveRecipientField("bcc")}
              onBlur={() => {
                window.setTimeout(() => setActiveRecipientField((current) => (current === "bcc" ? null : current)), 120);
              }}
              onChange={(event) => {
                setBcc(event.target.value);
                setActiveRecipientField("bcc");
              }}
            />
            {activeRecipientField === "bcc" ? (
              <RecipientSuggestionList
                suggestions={bccSuggestionItems}
                onPick={(email) => applyRecipientSuggestion("bcc", email)}
              />
            ) : null}
          </div>
          {bccRecipients.length > 0 ? <RecipientChips emails={bccRecipients} /> : null}
        </div>
      ) : null}
      <input
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        placeholder="Konu"
        value={subject}
        onChange={(event) => setSubject(event.target.value)}
      />
      <div className="grid gap-2 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs font-medium text-slate-700">İmza</p>
          {signatures.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                value={selectedSignatureId}
                onChange={(event) => setSelectedSignatureId(event.target.value)}
              >
                {signatures.map((signature) => (
                  <option key={signature.id} value={signature.id}>
                    {signature.name}
                    {signature.isDefault ? " (Varsayılan)" : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                onClick={appendSignature}
              >
                İmzayı Ekle
              </button>
            </div>
          ) : (
            <p className="mt-2 text-xs text-slate-500">Henüz kayıtlı imza yok.</p>
          )}
          <button
            type="button"
            className="mt-2 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            onClick={() => {
              void createSignatureFromCurrentContent();
            }}
          >
            Mevcut İçerikten İmza Oluştur
          </button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs font-medium text-slate-700">Şablon</p>
          {frequentTemplates.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-500">Sık Kullanılan:</span>
              {frequentTemplates.map((template) => (
                <button
                  key={`frequent-${template.id}`}
                  type="button"
                  className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100"
                  onClick={() => applyTemplate(template.id)}
                >
                  {template.name} ({templateUsage[template.id]?.count ?? 0})
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
            >
              <option value="">Şablon seçin</option>
              {sortedTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {(templateUsage[template.id]?.count ?? 0) > 0
                    ? `${template.name} (${templateUsage[template.id]?.count})`
                    : template.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-60"
              disabled={selectedTemplateId.length === 0}
              onClick={() => applyTemplate()}
            >
              Şablonu Uygula
            </button>
          </div>
        </div>
      </div>
      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`rounded border px-2 py-1 text-xs ${
              mode === "plain"
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-slate-300 bg-white text-slate-700"
            }`}
            onClick={() => switchMode("plain")}
          >
            Düz Metin
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-1 text-xs ${
              mode === "rich"
                ? "border-orange-300 bg-orange-50 text-orange-700"
                : "border-slate-300 bg-white text-slate-700"
            }`}
            onClick={() => switchMode("rich")}
          >
            Zengin Metin
          </button>
          {mode === "rich" ? (
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <ToolbarButton label="B" title="Kalın" onClick={() => execRichCommand("bold")} />
              <ToolbarButton label="I" title="İtalik" onClick={() => execRichCommand("italic")} />
              <ToolbarButton
                label="U"
                title="Altı Çizili"
                onClick={() => execRichCommand("underline")}
              />
              <ToolbarButton
                label="• Liste"
                title="Madde İşaretli Liste"
                onClick={() => execRichCommand("insertUnorderedList")}
              />
              <ToolbarButton
                label="1. Liste"
                title="Numaralı Liste"
                onClick={() => execRichCommand("insertOrderedList")}
              />
              <ToolbarButton
                label="Sol"
                title="Sola Hizala"
                onClick={() => execRichCommand("justifyLeft")}
              />
              <ToolbarButton
                label="Orta"
                title="Ortala"
                onClick={() => execRichCommand("justifyCenter")}
              />
              <ToolbarButton
                label="Sağ"
                title="Sağa Hizala"
                onClick={() => execRichCommand("justifyRight")}
              />
              <ToolbarButton
                label="Link"
                title="Link Ekle"
                onClick={() => {
                  const input = window.prompt("Link URL girin (https://...)");
                  const safe = sanitizeLink(input);
                  if (safe) {
                    execRichCommand("createLink", safe);
                  }
                }}
              />
              <ToolbarButton
                label="Resim"
                title="Inline Resim Ekle"
                onClick={() => {
                  inlineImageInputRef.current?.click();
                }}
              />
            </div>
          ) : null}
        </div>
        <input
          ref={inlineImageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) {
              void insertInlineImage(selected);
            }
            event.currentTarget.value = "";
          }}
        />

        {mode === "plain" ? (
          <textarea
            className="min-h-[220px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="Mesaj"
            spellCheck
            lang="tr"
            style={{ fontFamily: composeFontFamily }}
            value={bodyText}
            onChange={(event) => setBodyText(event.target.value)}
          />
        ) : (
          <div
            ref={richEditorRef}
            className="min-h-[220px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
            contentEditable
            spellCheck
            lang="tr"
            style={{ fontFamily: composeFontFamily }}
            suppressContentEditableWarning
            onInput={(event) => {
              syncRichContent(event.currentTarget);
            }}
            onBlur={(event) => {
              syncRichContent(event.currentTarget);
            }}
          />
        )}
      </div>
      <AttachmentUploader
        onSelect={(files) => {
          void stageFiles(files);
        }}
      />
      {attachments.length > 0 ? (
        <ul className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {attachments.map((file) => (
            <li key={`${file.name}-${file.sizeBytes}`} className="truncate">
              {file.name} ({formatBytes(file.sizeBytes)})
            </li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-1 text-xs text-slate-500">
        <p>Ek limiti: dosya başına 25MB, en fazla {MAX_ATTACHMENT_COUNT} dosya.</p>
        {attachments.length > 0 ? <p>Toplam ek boyutu: {formatBytes(totalAttachmentBytes)}</p> : null}
        {totalAttachmentBytes > LARGE_ATTACHMENT_WARNING_BYTES ? (
          <p className="text-amber-700">
            Büyük ek uyarısı: toplam boyut bazı sağlayıcılarda gönderim limitini aşabilir.
          </p>
        ) : null}
        {attachmentMentioned && attachments.length === 0 ? (
          <p className="text-amber-700">
            Mesaj içinde "ek" ifadesi tespit edildi ancak dosya eklenmedi.
          </p>
        ) : null}
        {subject.trim().length === 0 ? <p className="text-amber-700">Konu alanı şu an boş.</p> : null}
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-medium text-slate-700">Zamanlanmış Gönderim</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-500">Gönderim Zaman Önerisi:</span>
          {scheduleSuggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100"
              onClick={() => {
                setScheduledAtLocal(toDateTimeLocalValue(suggestion.value));
                setStatus(`Önerilen gönderim zamanı seçildi: ${suggestion.label}`);
              }}
            >
              {suggestion.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            value={scheduledAtLocal}
            onChange={(event) => setScheduledAtLocal(event.target.value)}
          />
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            disabled={isSaving || isSending || isScheduling || isUploading}
            onClick={() => {
              const iso = toIsoFromLocalDateTime(scheduledAtLocal);
              if (!iso) {
                setStatus("Geçerli bir zaman seçin");
                return;
              }
              void scheduleSend({ scheduledAtIso: iso });
            }}
          >
            {isScheduling ? "Zamanlanıyor..." : "Zamanla"}
          </button>
          <button
            type="button"
            className="rounded border border-orange-300 bg-orange-50 px-2 py-1 text-xs text-orange-700"
            disabled={isSaving || isSending || isScheduling || isUploading}
            onClick={() => {
              const iso = new Date(Date.now() + 10_000).toISOString();
              void scheduleSend({ scheduledAtIso: iso, undoWindowSeconds: 10 });
            }}
          >
            10 sn Geri Alma ile Zamanla
          </button>
        </div>
      </div>
      {undoScheduledDraftId && undoSecondsLeft > 0 ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p>
            Mail gönderim kuyruğunda. {undoSecondsLeft} sn içinde geri alabilirsiniz.
          </p>
          <button
            type="button"
            className="mt-2 rounded border border-amber-300 px-2 py-1"
            onClick={() => {
              void undoScheduledSend();
            }}
          >
            Göndermeyi Geri Al
          </button>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <button
          className="rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-2 text-sm text-blue-800"
          type="button"
          disabled={isSaving || isSending || isUploading || isScheduling}
          onClick={() => {
            void autosave(false);
          }}
        >
          {isSaving ? "Kaydediliyor..." : "Taslak Kaydet"}
        </button>
        <button
          className="rounded-lg bg-gradient-to-r from-blue-600 to-orange-500 px-3 py-2 text-sm font-medium text-white shadow-[0_14px_28px_-16px_rgba(37,99,235,0.7)] disabled:opacity-60"
          type="button"
          disabled={isSaving || isSending || isUploading || isScheduling}
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

function buildScheduleSuggestions(now: Date): ScheduleSuggestion[] {
  const nextBusinessMorning = nextBusinessDateAt(now, 9, 30);
  const nextBusinessAfternoon = nextBusinessDateAt(now, 14, 0);
  const nextMondayMorning = nextSpecificWeekdayAt(now, 1, 9, 30);

  return [
    {
      id: "business-morning",
      label: formatSuggestionLabel("En yakın iş sabahı", nextBusinessMorning),
      value: nextBusinessMorning
    },
    {
      id: "business-afternoon",
      label: formatSuggestionLabel("En yakın iş öğleden sonra", nextBusinessAfternoon),
      value: nextBusinessAfternoon
    },
    {
      id: "next-monday",
      label: formatSuggestionLabel("Pazartesi 09:30", nextMondayMorning),
      value: nextMondayMorning
    }
  ];
}

function nextBusinessDateAt(base: Date, hour: number, minute: number): Date {
  const candidate = new Date(base);
  candidate.setSeconds(0, 0);
  candidate.setHours(hour, minute, 0, 0);

  if (candidate.getTime() <= base.getTime() + 60_000) {
    candidate.setDate(candidate.getDate() + 1);
  }

  while (candidate.getDay() === 0 || candidate.getDay() === 6) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate;
}

function nextSpecificWeekdayAt(base: Date, weekday: number, hour: number, minute: number): Date {
  const result = new Date(base);
  result.setSeconds(0, 0);
  result.setHours(hour, minute, 0, 0);

  const currentWeekday = result.getDay();
  let offset = (weekday - currentWeekday + 7) % 7;
  if (offset === 0 && result.getTime() <= base.getTime() + 60_000) {
    offset = 7;
  }
  result.setDate(result.getDate() + offset);

  return result;
}

function formatSuggestionLabel(prefix: string, value: Date): string {
  return `${prefix}: ${value.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function parseRecipients(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function buildSuggestionsForField(
  rawValue: string,
  existingRecipients: string[],
  suggestions: RecipientSuggestion[]
): RecipientSuggestion[] {
  const token = extractCurrentRecipientToken(rawValue);
  const normalizedToken = token.toLowerCase();
  const existingSet = new Set(existingRecipients.map((item) => item.toLowerCase()));

  return suggestions
    .filter((suggestion) => {
      const email = suggestion.email.trim();
      if (!email || existingSet.has(email.toLowerCase())) {
        return false;
      }

      if (!normalizedToken) {
        return true;
      }

      const name = suggestion.name?.toLowerCase() ?? "";
      return email.toLowerCase().includes(normalizedToken) || name.includes(normalizedToken);
    })
    .slice(0, 8);
}

function extractCurrentRecipientToken(value: string): string {
  const cursor = value.lastIndexOf(",");
  if (cursor < 0) {
    return value.trim();
  }
  return value.slice(cursor + 1).trim();
}

function replaceCurrentRecipientToken(value: string, email: string): string {
  const targetEmail = email.trim();
  if (!targetEmail) {
    return value;
  }

  const cursor = value.lastIndexOf(",");
  const prefix = cursor >= 0 ? value.slice(0, cursor + 1) : "";
  const recipients = parseRecipients(prefix);
  const exists = recipients.some((item) => item.toLowerCase() === targetEmail.toLowerCase());
  if (exists) {
    return recipients.join(", ");
  }

  return [...recipients, targetEmail].join(", ");
}

function RecipientSuggestionList({
  suggestions,
  onPick
}: {
  suggestions: RecipientSuggestion[];
  onPick: (email: string) => void;
}) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-1">
      <ul className="space-y-1">
        {suggestions.map((suggestion) => (
          <li key={`${suggestion.source}-${suggestion.email}`}>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-50"
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(suggestion.email);
              }}
            >
              <span className="truncate">
                {suggestion.name ? `${suggestion.name} <${suggestion.email}>` : suggestion.email}
              </span>
              <span className="ml-2 shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                {suggestion.source === "recent"
                  ? "Son"
                  : suggestion.source === "contact"
                    ? "Kişi"
                    : "Müvekkil"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectAttachmentMention(value: string): boolean {
  return /\b(ek|ekli|ekte|ekledim|attachment|attached)\b/i.test(value);
}

function plainTextToHtml(text: string): string {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return escaped.replaceAll("\n", "<br/>");
}

function resolveComposeFontFamily(font: ComposeFont): string {
  if (font === "sans") {
    return "Arial, Helvetica, sans-serif";
  }

  if (font === "serif") {
    return "Georgia, Times New Roman, serif";
  }

  if (font === "mono") {
    return "Courier New, Courier, monospace";
  }

  return "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif";
}

function wrapHtmlWithFont(html: string, fontFamily: string): string {
  if (html.trim().length === 0) {
    return html;
  }

  return `<div style="font-family:${fontFamily};">${html}</div>`;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function sanitizeLink(input: string | null): string | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("mailto:")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function toDateTimeLocalValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toIsoFromLocalDateTime(value: string): string | null {
  if (value.trim().length === 0) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
        return;
      }
      reject(new Error("Inline image read failed"));
    };
    reader.onerror = () => reject(new Error("Inline image read failed"));
    reader.readAsDataURL(file);
  });
}

function ToolbarButton({
  label,
  title,
  onClick
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
