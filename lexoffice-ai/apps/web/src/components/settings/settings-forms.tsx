"use client";

import { useEffect, useState } from "react";
import {
  APPEARANCE_CHANGED_EVENT,
  applyAppearancePreferences,
  type DensityPreference,
  getDefaultAppearancePreferences,
  type MailLayoutPreference,
  type MailReadingPanePosition,
  readAppearancePreferences,
  type ThemePreference,
  writeAppearancePreferences
} from "@/lib/appearance-preferences";
import { withBasePath } from "@/lib/base-path";
import {
  MAIL_NOTIFICATION_CHANGED_EVENT,
  getDefaultMailNotificationPreferences,
  readMailNotificationPreferences,
  type MailNotificationPreferences,
  writeMailNotificationPreferences
} from "@/lib/mail-notification-preferences";

type SessionEntry = {
  id: string;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  mfaVerifiedAt: string | null;
  isCurrent: boolean;
};

type SignatureEntry = {
  id: string;
  name: string;
  htmlBody: string;
  textBody: string | null;
  isDefault: boolean;
  updatedAt: string;
};

type MailboxEntry = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
};

type ComposeFont = "system" | "sans" | "serif" | "mono";
type SenderListKind = "WHITELIST" | "BLACKLIST" | "BLOCKED";

type FilterRuleEntry = {
  id: string;
  tenantId: string;
  mailboxId: string | null;
  name: string;
  enabled: boolean;
  priority: number;
  fromPattern: string | null;
  subjectPattern: string | null;
  bodyPattern: string | null;
  hasAttachments: boolean | null;
  actionState: "RECEIVED" | "SENT" | "DRAFT" | "SCHEDULED" | "ARCHIVED" | "TRASH" | "SPAM" | null;
  actionMarkRead: boolean;
  actionStar: boolean;
  actionImportant: boolean;
  actionLabelName: string | null;
  actionForwardTo: string | null;
  stopProcessing: boolean;
};

type SenderListEntry = {
  id: string;
  tenantId: string;
  kind: SenderListKind;
  emailOrDomain: string;
  note: string | null;
};

export function SettingsForms({
  tenantId,
  tenantName,
  locale,
  timezone,
  mailConversationViewEnabled,
  composeDefaultFont,
  defaultSenderMailboxId,
  mailForwardingEnabled,
  mailForwardingRecipients,
  mailForwardingMailboxId,
  autoResponderEnabled,
  autoResponderSubject,
  autoResponderBodyText
}: {
  tenantId: string;
  tenantName: string;
  locale: string;
  timezone: string;
  mailConversationViewEnabled: boolean;
  composeDefaultFont: ComposeFont;
  defaultSenderMailboxId: string | null;
  mailForwardingEnabled: boolean;
  mailForwardingRecipients: string[];
  mailForwardingMailboxId: string | null;
  autoResponderEnabled: boolean;
  autoResponderSubject: string;
  autoResponderBodyText: string;
}) {
  const [name, setName] = useState(tenantName);
  const [selectedLocale, setSelectedLocale] = useState(locale);
  const [selectedTimezone, setSelectedTimezone] = useState(timezone);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const [densityPreference, setDensityPreference] = useState<DensityPreference>("comfortable");
  const [mailLayoutPreference, setMailLayoutPreference] = useState<MailLayoutPreference>("split");
  const [mailReadingPanePosition, setMailReadingPanePosition] =
    useState<MailReadingPanePosition>("right");
  const [notificationPreferences, setNotificationPreferences] = useState<MailNotificationPreferences>(
    getDefaultMailNotificationPreferences()
  );
  const [conversationViewEnabled, setConversationViewEnabled] = useState(mailConversationViewEnabled);
  const [selectedComposeFont, setSelectedComposeFont] = useState<ComposeFont>(composeDefaultFont);
  const [selectedDefaultSenderMailboxId, setSelectedDefaultSenderMailboxId] = useState(
    defaultSenderMailboxId ?? ""
  );
  const [forwardingEnabled, setForwardingEnabled] = useState(mailForwardingEnabled);
  const [forwardingRecipientsRaw, setForwardingRecipientsRaw] = useState(
    mailForwardingRecipients.join(", ")
  );
  const [forwardingMailboxId, setForwardingMailboxId] = useState(mailForwardingMailboxId ?? "");
  const [autoResponderEnabledState, setAutoResponderEnabledState] = useState(autoResponderEnabled);
  const [autoResponderSubjectState, setAutoResponderSubjectState] = useState(autoResponderSubject);
  const [autoResponderBodyTextState, setAutoResponderBodyTextState] = useState(autoResponderBodyText);
  const [mailboxes, setMailboxes] = useState<MailboxEntry[]>([]);
  const [filterRules, setFilterRules] = useState<FilterRuleEntry[]>([]);
  const [senderListEntries, setSenderListEntries] = useState<SenderListEntry[]>([]);
  const [mailPolicyStatus, setMailPolicyStatus] = useState<string | null>(null);
  const [mailPolicyPending, setMailPolicyPending] = useState(false);
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleFromPattern, setNewRuleFromPattern] = useState("");
  const [newRuleSubjectPattern, setNewRuleSubjectPattern] = useState("");
  const [newRuleStateAction, setNewRuleStateAction] = useState<"none" | "ARCHIVED" | "TRASH" | "SPAM">(
    "none"
  );
  const [newRuleForwardTo, setNewRuleForwardTo] = useState("");
  const [newRuleMarkRead, setNewRuleMarkRead] = useState(false);
  const [newRuleStop, setNewRuleStop] = useState(false);
  const [newSenderKind, setNewSenderKind] = useState<SenderListKind>("BLOCKED");
  const [newSenderValue, setNewSenderValue] = useState("");
  const [appearanceStatus, setAppearanceStatus] = useState<string | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<SignatureEntry[]>([]);
  const [signatureName, setSignatureName] = useState("");
  const [signatureTextBody, setSignatureTextBody] = useState("");
  const [signatureHtmlBody, setSignatureHtmlBody] = useState("");
  const [signaturePending, setSignaturePending] = useState(false);
  const [signatureStatus, setSignatureStatus] = useState<string | null>(null);
  const [privacyStatus, setPrivacyStatus] = useState<string | null>(null);
  const [privacyExportPending, setPrivacyExportPending] = useState(false);
  const [privacyErasePending, setPrivacyErasePending] = useState(false);
  const [privacyEraseReason, setPrivacyEraseReason] = useState("");

  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [disableMfaCode, setDisableMfaCode] = useState("");
  const [mfaEnrollmentToken, setMfaEnrollmentToken] = useState<string | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaOtpAuthUrl, setMfaOtpAuthUrl] = useState<string | null>(null);
  const [securityStatus, setSecurityStatus] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  useEffect(() => {
    const currentAppearance = readAppearancePreferences();
    setThemePreference(currentAppearance.theme);
    setDensityPreference(currentAppearance.density);
    setMailLayoutPreference(currentAppearance.mailLayout);
    setMailReadingPanePosition(currentAppearance.mailReadingPanePosition);
    setNotificationPreferences(readMailNotificationPreferences());
    void refreshSecurity();
    void refreshMailboxes();
    void refreshSignatures();
    void refreshMailPolicies();
  }, []);

  async function refreshSecurity(): Promise<void> {
    const [meResponse, sessionsResponse] = await Promise.all([
      fetch(withBasePath("/api/v1/auth/me"), { cache: "no-store" }),
      fetch(withBasePath("/api/v1/auth/sessions"), { cache: "no-store" })
    ]);

    const mePayload = (await meResponse.json()) as {
      ok: boolean;
      data?: {
        user: {
          mfaEnabled: boolean;
        };
      };
    };

    const sessionsPayload = (await sessionsResponse.json()) as {
      ok: boolean;
      data?: {
        sessions: SessionEntry[];
      };
    };

    if (mePayload.ok && mePayload.data) {
      setMfaEnabled(mePayload.data.user.mfaEnabled);
    }

    if (sessionsPayload.ok && sessionsPayload.data) {
      setSessions(sessionsPayload.data.sessions);
    }
  }

  async function refreshSignatures(): Promise<void> {
    const params = new URLSearchParams({ tenantId });
    const response = await fetch(withBasePath(`/api/v1/mail/signatures?${params.toString()}`), {
      method: "GET",
      cache: "no-store"
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: {
        signatures: SignatureEntry[];
      };
      error?: { message: string };
    };

    if (!payload.ok || !payload.data) {
      return;
    }

    setSignatures(payload.data.signatures);
  }

  async function refreshMailboxes(): Promise<void> {
    const params = new URLSearchParams({ tenantId });
    const response = await fetch(withBasePath(`/api/v1/mailboxes?${params.toString()}`), {
      method: "GET",
      cache: "no-store"
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: {
        mailboxes: MailboxEntry[];
      };
    };

    if (!payload.ok || !payload.data) {
      return;
    }

    setMailboxes(payload.data.mailboxes);
  }

  async function refreshMailPolicies(): Promise<void> {
    const params = new URLSearchParams({ tenantId });
    const [rulesResponse, senderListResponse] = await Promise.all([
      fetch(withBasePath(`/api/v1/mail/settings/filter-rules?${params.toString()}`), {
        method: "GET",
        cache: "no-store"
      }),
      fetch(withBasePath(`/api/v1/mail/settings/sender-lists?${params.toString()}`), {
        method: "GET",
        cache: "no-store"
      })
    ]);

    const rulesPayload = (await rulesResponse.json()) as {
      ok: boolean;
      data?: {
        rules: FilterRuleEntry[];
      };
    };
    const senderPayload = (await senderListResponse.json()) as {
      ok: boolean;
      data?: {
        entries: SenderListEntry[];
      };
    };

    if (rulesPayload.ok && rulesPayload.data) {
      setFilterRules(rulesPayload.data.rules);
    }
    if (senderPayload.ok && senderPayload.data) {
      setSenderListEntries(senderPayload.data.entries);
    }
  }

  async function save(): Promise<void> {
    const forwardingRecipients = parseRecipientList(forwardingRecipientsRaw);

    if (forwardingEnabled && forwardingRecipients.length === 0) {
      setStatus("Mail yönlendirme açıkken en az bir hedef e-posta girin");
      return;
    }

    if (
      autoResponderEnabledState &&
      (autoResponderSubjectState.trim().length === 0 || autoResponderBodyTextState.trim().length === 0)
    ) {
      setStatus("Otomatik yanıtlayıcı açıkken konu ve mesaj metni zorunlu");
      return;
    }

    setPending(true);
    setStatus(null);

    const response = await fetch(withBasePath("/api/v1/settings/tenant"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        name,
        locale: selectedLocale,
        timezone: selectedTimezone,
        mailConversationViewEnabled: conversationViewEnabled,
        composeDefaultFont: selectedComposeFont,
        defaultSenderMailboxId:
          selectedDefaultSenderMailboxId.trim().length > 0 ? selectedDefaultSenderMailboxId : null,
        mailForwardingEnabled: forwardingEnabled,
        mailForwardingRecipients: forwardingRecipients,
        mailForwardingMailboxId: forwardingMailboxId.trim().length > 0 ? forwardingMailboxId : null,
        autoResponderEnabled: autoResponderEnabledState,
        autoResponderSubject:
          autoResponderSubjectState.trim().length > 0 ? autoResponderSubjectState.trim() : null,
        autoResponderBodyText:
          autoResponderBodyTextState.trim().length > 0 ? autoResponderBodyTextState.trim() : null
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setStatus(payload.error?.message ?? "Ayarlar kaydedilemedi");
      setPending(false);
      return;
    }

    setStatus("Ayarlar kaydedildi");
    setPending(false);
  }

  async function startMfa(): Promise<void> {
    setSecurityStatus("MFA kurulumu başlatılıyor...");

    const response = await fetch(withBasePath("/api/v1/auth/mfa/start"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tenantId })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: {
        enrollmentToken: string;
        secret: string;
        otpauthUrl: string;
      };
      error?: { message: string };
    };

    if (!payload.ok || !payload.data) {
      setSecurityStatus(payload.error?.message ?? "MFA kurulumu başlatılamadı");
      return;
    }

    setMfaEnrollmentToken(payload.data.enrollmentToken);
    setMfaSecret(payload.data.secret);
    setMfaOtpAuthUrl(payload.data.otpauthUrl);
    setSecurityStatus("Doğrulama uygulamasında MFA hesabını ekleyin ve 6 haneli kodu girin.");
  }

  async function verifyMfa(): Promise<void> {
    if (!mfaEnrollmentToken || mfaCode.trim().length !== 6) {
      setSecurityStatus("Geçerli bir MFA kodu girin");
      return;
    }

    const response = await fetch(withBasePath("/api/v1/auth/mfa/verify"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        enrollmentToken: mfaEnrollmentToken,
        code: mfaCode.trim()
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setSecurityStatus(payload.error?.message ?? "MFA etkinleştirilemedi");
      return;
    }

    setSecurityStatus("MFA başarıyla etkinleştirildi");
    setMfaEnrollmentToken(null);
    setMfaSecret(null);
    setMfaOtpAuthUrl(null);
    setMfaCode("");
    await refreshSecurity();
  }

  async function disableMfa(): Promise<void> {
    if (disableMfaCode.trim().length !== 6) {
      setSecurityStatus("MFA kapatmak için 6 haneli kod girin");
      return;
    }

    const response = await fetch(withBasePath("/api/v1/auth/mfa/disable"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        code: disableMfaCode.trim()
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setSecurityStatus(payload.error?.message ?? "MFA devre dışı bırakılamadı");
      return;
    }

    setSecurityStatus("MFA devre dışı bırakıldı");
    setDisableMfaCode("");
    await refreshSecurity();
  }

  async function revokeSession(sessionId: string): Promise<void> {
    const response = await fetch(withBasePath("/api/v1/auth/sessions/revoke"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sessionId })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setSecurityStatus(payload.error?.message ?? "Session revoke başarısız");
      return;
    }

    setSecurityStatus("Session sonlandırıldı");
    await refreshSecurity();
  }

  async function revokeOtherSessions(): Promise<void> {
    const response = await fetch(withBasePath("/api/v1/auth/sessions/revoke-others"), {
      method: "POST"
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setSecurityStatus(payload.error?.message ?? "Diğer sessionlar sonlandırılamadı");
      return;
    }

    setSecurityStatus("Diğer tüm sessionlar sonlandırıldı");
    await refreshSecurity();
  }

  function saveAppearance(): void {
    const defaults = getDefaultAppearancePreferences();
    const nextAppearance = {
      theme: themePreference ?? defaults.theme,
      density: densityPreference ?? defaults.density,
      mailLayout: mailLayoutPreference ?? defaults.mailLayout,
      mailReadingPanePosition: mailReadingPanePosition ?? defaults.mailReadingPanePosition
    };

    writeAppearancePreferences(nextAppearance);
    applyAppearancePreferences(nextAppearance);
    window.dispatchEvent(new Event(APPEARANCE_CHANGED_EVENT));
    setAppearanceStatus("Tema ve görünüm ayarları güncellendi");
  }

  async function saveNotificationSettings(): Promise<void> {
    if (notificationPreferences.desktopEnabled && typeof window !== "undefined") {
      if (!("Notification" in window)) {
        setNotificationStatus("Tarayıcı masaüstü bildirimi desteklemiyor.");
        return;
      }

      if (Notification.permission === "granted") {
        const normalized = writeMailNotificationPreferences(notificationPreferences);
        setNotificationPreferences(normalized);
        window.dispatchEvent(new Event(MAIL_NOTIFICATION_CHANGED_EVENT));
        setNotificationStatus("Bildirim ayarları güncellendi");
        return;
      }

      if (Notification.permission === "denied") {
        setNotificationStatus("Tarayıcı bildirim izni engellendi. Ayarlardan izin verin.");
        return;
      }

      const result = await Notification.requestPermission();
      if (result !== "granted") {
        setNotificationStatus("Masaüstü bildirim izni verilmedi.");
        return;
      }
    }

    const normalized = writeMailNotificationPreferences(notificationPreferences);
    setNotificationPreferences(normalized);
    window.dispatchEvent(new Event(MAIL_NOTIFICATION_CHANGED_EVENT));
    setNotificationStatus("Bildirim ayarları güncellendi");
  }

  async function createSignature(): Promise<void> {
    const trimmedName = signatureName.trim();
    const trimmedText = signatureTextBody.trim();
    const trimmedHtml = signatureHtmlBody.trim();

    if (trimmedName.length === 0) {
      setSignatureStatus("İmza adı zorunlu");
      return;
    }

    if (trimmedText.length === 0 && trimmedHtml.length === 0) {
      setSignatureStatus("İmza içeriği için metin veya HTML girin");
      return;
    }

    setSignaturePending(true);
    setSignatureStatus(null);

    const response = await fetch(withBasePath("/api/v1/mail/signatures"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        name: trimmedName,
        htmlBody: trimmedHtml.length > 0 ? trimmedHtml : plainTextToHtml(trimmedText),
        ...(trimmedText.length > 0 ? { textBody: trimmedText } : {}),
        isDefault: signatures.length === 0
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setSignatureStatus(payload.error?.message ?? "İmza eklenemedi");
      setSignaturePending(false);
      return;
    }

    setSignatureName("");
    setSignatureTextBody("");
    setSignatureHtmlBody("");
    setSignaturePending(false);
    setSignatureStatus("İmza kaydedildi");
    await refreshSignatures();
  }

  async function setDefaultSignature(signatureId: string): Promise<void> {
    setSignaturePending(true);
    setSignatureStatus(null);

    const response = await fetch(withBasePath(`/api/v1/mail/signatures/${signatureId}`), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        isDefault: true
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setSignatureStatus(payload.error?.message ?? "Varsayılan imza güncellenemedi");
      setSignaturePending(false);
      return;
    }

    setSignaturePending(false);
    setSignatureStatus("Varsayılan imza güncellendi");
    await refreshSignatures();
  }

  async function deleteSignature(signatureId: string): Promise<void> {
    const confirmed = window.confirm("Bu imzayı silmek istediğinize emin misiniz?");
    if (!confirmed) {
      return;
    }

    setSignaturePending(true);
    setSignatureStatus(null);

    const response = await fetch(withBasePath(`/api/v1/mail/signatures/${signatureId}`), {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setSignatureStatus(payload.error?.message ?? "İmza silinemedi");
      setSignaturePending(false);
      return;
    }

    setSignaturePending(false);
    setSignatureStatus("İmza silindi");
    await refreshSignatures();
  }

  async function createFilterRule(): Promise<void> {
    const trimmedName = newRuleName.trim();
    if (trimmedName.length === 0) {
      setMailPolicyStatus("Kural adı zorunlu");
      return;
    }

    if (
      newRuleFromPattern.trim().length === 0 &&
      newRuleSubjectPattern.trim().length === 0 &&
      newRuleStateAction === "none" &&
      newRuleForwardTo.trim().length === 0 &&
      !newRuleMarkRead
    ) {
      setMailPolicyStatus("En az bir koşul veya aksiyon tanımlayın");
      return;
    }

    setMailPolicyPending(true);
    setMailPolicyStatus(null);

    const response = await fetch(withBasePath("/api/v1/mail/settings/filter-rules"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        mailboxId: null,
        name: trimmedName,
        fromPattern: newRuleFromPattern.trim().length > 0 ? newRuleFromPattern.trim() : null,
        subjectPattern: newRuleSubjectPattern.trim().length > 0 ? newRuleSubjectPattern.trim() : null,
        actionState: newRuleStateAction === "none" ? null : newRuleStateAction,
        actionForwardTo: newRuleForwardTo.trim().length > 0 ? newRuleForwardTo.trim() : null,
        actionMarkRead: newRuleMarkRead,
        stopProcessing: newRuleStop,
        enabled: true
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setMailPolicyPending(false);
      setMailPolicyStatus(payload.error?.message ?? "Filtre kuralı kaydedilemedi");
      return;
    }

    setNewRuleName("");
    setNewRuleFromPattern("");
    setNewRuleSubjectPattern("");
    setNewRuleStateAction("none");
    setNewRuleForwardTo("");
    setNewRuleMarkRead(false);
    setNewRuleStop(false);
    setMailPolicyPending(false);
    setMailPolicyStatus("Filtre kuralı kaydedildi");
    await refreshMailPolicies();
  }

  async function toggleFilterRule(rule: FilterRuleEntry): Promise<void> {
    setMailPolicyPending(true);
    setMailPolicyStatus(null);

    const response = await fetch(withBasePath(`/api/v1/mail/settings/filter-rules/${rule.id}`), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        enabled: !rule.enabled
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setMailPolicyPending(false);
      setMailPolicyStatus(payload.error?.message ?? "Kural güncellenemedi");
      return;
    }

    setMailPolicyPending(false);
    setMailPolicyStatus("Kural güncellendi");
    await refreshMailPolicies();
  }

  async function deleteFilterRule(ruleId: string): Promise<void> {
    const confirmed = window.confirm("Bu filtre kuralını silmek istediğinize emin misiniz?");
    if (!confirmed) {
      return;
    }

    setMailPolicyPending(true);
    setMailPolicyStatus(null);

    const response = await fetch(withBasePath(`/api/v1/mail/settings/filter-rules/${ruleId}`), {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setMailPolicyPending(false);
      setMailPolicyStatus(payload.error?.message ?? "Kural silinemedi");
      return;
    }

    setMailPolicyPending(false);
    setMailPolicyStatus("Kural silindi");
    await refreshMailPolicies();
  }

  async function addSenderListEntry(): Promise<void> {
    const value = newSenderValue.trim();
    if (value.length === 0) {
      setMailPolicyStatus("Gönderen e-posta veya @domain.com girin");
      return;
    }

    setMailPolicyPending(true);
    setMailPolicyStatus(null);

    const response = await fetch(withBasePath("/api/v1/mail/settings/sender-lists"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId,
        kind: newSenderKind,
        emailOrDomain: value
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setMailPolicyPending(false);
      setMailPolicyStatus(payload.error?.message ?? "Liste kaydı başarısız");
      return;
    }

    setNewSenderValue("");
    setMailPolicyPending(false);
    setMailPolicyStatus("Gönderen listesine eklendi");
    await refreshMailPolicies();
  }

  async function deleteSenderListEntry(entryId: string): Promise<void> {
    setMailPolicyPending(true);
    setMailPolicyStatus(null);

    const response = await fetch(withBasePath(`/api/v1/mail/settings/sender-lists/${entryId}`), {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setMailPolicyPending(false);
      setMailPolicyStatus(payload.error?.message ?? "Liste kaydı silinemedi");
      return;
    }

    setMailPolicyPending(false);
    setMailPolicyStatus("Gönderen listesi güncellendi");
    await refreshMailPolicies();
  }

  async function exportPrivacyData(): Promise<void> {
    setPrivacyExportPending(true);
    setPrivacyStatus(null);

    const response = await fetch(withBasePath("/api/v1/privacy/export"), {
      method: "GET",
      cache: "no-store"
    });

    const payload = (await response.json()) as {
      ok: boolean;
      data?: unknown;
      error?: { message: string };
    };

    if (!payload.ok || !payload.data) {
      setPrivacyStatus(payload.error?.message ?? "Veri dışa aktarma başarısız");
      setPrivacyExportPending(false);
      return;
    }

    const blob = new Blob([JSON.stringify(payload.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `privacy-export-${tenantId}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setPrivacyStatus("Veri dışa aktarımı hazırlandı ve indirildi");
    setPrivacyExportPending(false);
  }

  async function requestPrivacyErase(): Promise<void> {
    setPrivacyErasePending(true);
    setPrivacyStatus(null);

    const response = await fetch(withBasePath("/api/v1/privacy/erase-request"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        reason: privacyEraseReason.trim() || undefined
      })
    });

    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };

    if (!payload.ok) {
      setPrivacyStatus(payload.error?.message ?? "Silme talebi oluşturulamadı");
      setPrivacyErasePending(false);
      return;
    }

    setPrivacyStatus("Silme talebi kaydedildi ve güvenlik loglarına işlendi");
    setPrivacyErasePending(false);
    setPrivacyEraseReason("");
  }

  return (
    <div className="space-y-4">
      <form className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Tenant Settings</h2>
        <label className="block text-xs text-slate-600">
          Tenant Adı
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs text-slate-600">
          Dil
          <select
            value={selectedLocale}
            onChange={(event) => setSelectedLocale(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="tr-TR">Türkçe (TR)</option>
            <option value="en-US">English (US)</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Zaman Dilimi
          <select
            value={selectedTimezone}
            onChange={(event) => setSelectedTimezone(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="Europe/Istanbul">Europe/Istanbul</option>
            <option value="UTC">UTC</option>
            <option value="Europe/London">Europe/London</option>
            <option value="America/New_York">America/New_York</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Konuşma Görünümü
          <select
            value={conversationViewEnabled ? "on" : "off"}
            onChange={(event) => setConversationViewEnabled(event.target.value === "on")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="on">Açık (mail zincirini birlikte göster)</option>
            <option value="off">Kapalı (yalnızca son mesajı göster)</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Varsayılan Yazı Tipi
          <select
            value={selectedComposeFont}
            onChange={(event) => setSelectedComposeFont(event.target.value as ComposeFont)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="system">Sistem</option>
            <option value="sans">Sans Serif</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Varsayılan Gönderici Hesabı
          <select
            value={selectedDefaultSenderMailboxId}
            onChange={(event) => setSelectedDefaultSenderMailboxId(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Sistem varsayılanı (ilk mailbox)</option>
            {mailboxes.map((mailbox) => (
              <option key={mailbox.id} value={mailbox.id}>
                {mailbox.displayName ? `${mailbox.displayName} <${mailbox.email}>` : mailbox.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Mail Yönlendirme
          <select
            value={forwardingEnabled ? "on" : "off"}
            onChange={(event) => setForwardingEnabled(event.target.value === "on")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="off">Kapalı</option>
            <option value="on">Açık</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Yönlendirme Mailbox Seçimi (opsiyonel)
          <select
            value={forwardingMailboxId}
            onChange={(event) => setForwardingMailboxId(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Tüm mailboxlar</option>
            {mailboxes.map((mailbox) => (
              <option key={`forward-${mailbox.id}`} value={mailbox.id}>
                {mailbox.displayName ? `${mailbox.displayName} <${mailbox.email}>` : mailbox.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Yönlendirme Alıcıları
          <input
            value={forwardingRecipientsRaw}
            onChange={(event) => setForwardingRecipientsRaw(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="ornek@firma.com, @domain.com değil sadece e-posta"
            disabled={!forwardingEnabled}
          />
        </label>
        <label className="block text-xs text-slate-600">
          Otomatik Yanıtlayıcı
          <select
            value={autoResponderEnabledState ? "on" : "off"}
            onChange={(event) => setAutoResponderEnabledState(event.target.value === "on")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="off">Kapalı</option>
            <option value="on">Açık</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Otomatik Yanıt Konusu
          <input
            value={autoResponderSubjectState}
            onChange={(event) => setAutoResponderSubjectState(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Örn: Mesajınızı aldık"
            disabled={!autoResponderEnabledState}
          />
        </label>
        <label className="block text-xs text-slate-600">
          Otomatik Yanıt Metni
          <textarea
            value={autoResponderBodyTextState}
            onChange={(event) => setAutoResponderBodyTextState(event.target.value)}
            rows={4}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Merhaba, mesajınızı aldık. En kısa sürede dönüş yapacağız."
            disabled={!autoResponderEnabledState}
          />
        </label>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-60"
          disabled={pending}
          onClick={() => {
            void save();
          }}
        >
          {pending ? "Kaydediliyor..." : "Kaydet"}
        </button>
        {status ? <p className="text-xs text-slate-600">{status}</p> : null}
      </form>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Tema ve Görünüm</h2>
        <label className="block text-xs text-slate-600">
          Tema
          <select
            value={themePreference}
            onChange={(event) => setThemePreference(event.target.value as ThemePreference)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="system">Sistem</option>
            <option value="light">Açık</option>
            <option value="dark">Koyu</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Yoğunluk
          <select
            value={densityPreference}
            onChange={(event) => setDensityPreference(event.target.value as DensityPreference)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="comfortable">Konforlu</option>
            <option value="compact">Sıkışık</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Mail Yerleşimi
          <select
            value={mailLayoutPreference}
            onChange={(event) => setMailLayoutPreference(event.target.value as MailLayoutPreference)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="split">Bölünmüş</option>
            <option value="list">Liste Odaklı</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Okuma Paneli Konumu
          <select
            value={mailReadingPanePosition}
            onChange={(event) =>
              setMailReadingPanePosition(event.target.value as MailReadingPanePosition)
            }
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            disabled={mailLayoutPreference === "list"}
          >
            <option value="right">Sağ</option>
            <option value="bottom">Alt</option>
            <option value="off">Kapalı</option>
          </select>
        </label>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
          onClick={saveAppearance}
        >
          Görünüm Ayarlarını Uygula
        </button>
        {appearanceStatus ? <p className="text-xs text-slate-600">{appearanceStatus}</p> : null}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Bildirim Ayarı</h2>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={notificationPreferences.desktopEnabled}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setNotificationPreferences((current) => ({ ...current, desktopEnabled: checked }));
            }}
          />
          Masaüstü bildirimi
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={notificationPreferences.soundEnabled}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setNotificationPreferences((current) => ({ ...current, soundEnabled: checked }));
            }}
          />
          Bildirim sesi
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={notificationPreferences.importantOnly}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setNotificationPreferences((current) => ({ ...current, importantOnly: checked }));
            }}
          />
          Sadece önemli mailler için bildirim
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={notificationPreferences.quietHoursEnabled}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setNotificationPreferences((current) => ({ ...current, quietHoursEnabled: checked }));
            }}
          />
          Sessiz saatler
        </label>
        {notificationPreferences.quietHoursEnabled ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span>Sessiz aralık:</span>
            <input
              type="time"
              className="rounded border border-slate-300 bg-white px-2 py-1"
              value={notificationPreferences.quietHoursStart}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setNotificationPreferences((current) => ({ ...current, quietHoursStart: value }));
              }}
            />
            <span>-</span>
            <input
              type="time"
              className="rounded border border-slate-300 bg-white px-2 py-1"
              value={notificationPreferences.quietHoursEnd}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setNotificationPreferences((current) => ({ ...current, quietHoursEnd: value }));
              }}
            />
          </div>
        ) : null}
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
          onClick={() => {
            void saveNotificationSettings();
          }}
        >
          Bildirim Ayarlarını Uygula
        </button>
        {notificationStatus ? <p className="text-xs text-slate-600">{notificationStatus}</p> : null}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Mail İmza Ayarı</h2>
        <p className="text-xs text-slate-600">
          Yeni imza ekleyebilir, varsayılan imzayı değiştirebilir veya gereksiz imzaları silebilirsiniz.
        </p>
        <label className="block text-xs text-slate-600">
          İmza Adı
          <input
            value={signatureName}
            onChange={(event) => setSignatureName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Örn: Kurumsal İmza"
          />
        </label>
        <label className="block text-xs text-slate-600">
          Düz Metin İçerik
          <textarea
            value={signatureTextBody}
            onChange={(event) => setSignatureTextBody(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Ad Soyad&#10;Ünvan&#10;Telefon"
          />
        </label>
        <label className="block text-xs text-slate-600">
          HTML İçerik (opsiyonel)
          <textarea
            value={signatureHtmlBody}
            onChange={(event) => setSignatureHtmlBody(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
            placeholder="&lt;p&gt;&lt;strong&gt;Ad Soyad&lt;/strong&gt;&lt;/p&gt;"
          />
        </label>
        <button
          type="button"
          disabled={signaturePending}
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-60"
          onClick={() => {
            void createSignature();
          }}
        >
          {signaturePending ? "Kaydediliyor..." : "İmza Ekle"}
        </button>

        {signatures.length === 0 ? (
          <p className="text-xs text-slate-500">Henüz kayıtlı imza yok.</p>
        ) : (
          <ul className="space-y-2">
            {signatures.map((signature) => (
              <li key={signature.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-800">
                    {signature.name}
                    {signature.isDefault ? " (Varsayılan)" : ""}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {!signature.isDefault ? (
                      <button
                        type="button"
                        disabled={signaturePending}
                        className="rounded border border-slate-300 px-2 py-1 text-[11px] disabled:opacity-60"
                        onClick={() => {
                          void setDefaultSignature(signature.id);
                        }}
                      >
                        Varsayılan Yap
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={signaturePending}
                      className="rounded border border-rose-300 px-2 py-1 text-[11px] text-rose-700 disabled:opacity-60"
                      onClick={() => {
                        void deleteSignature(signature.id);
                      }}
                    >
                      Sil
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-slate-600">
                  {signature.textBody?.trim().length ? signature.textBody : "HTML imza içeriği"}
                </p>
              </li>
            ))}
          </ul>
        )}
        {signatureStatus ? <p className="text-xs text-slate-600">{signatureStatus}</p> : null}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Mail Filtre Kuralları</h2>
        <p className="text-xs text-slate-600">
          Yeni gelen maillerde gönderen/konu eşleşmesine göre arşivleme, spam, okundu veya yönlendirme
          aksiyonu tanımlayabilirsiniz.
        </p>
        <label className="block text-xs text-slate-600">
          Kural Adı
          <input
            value={newRuleName}
            onChange={(event) => setNewRuleName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Örn: Fatura mailleri"
          />
        </label>
        <label className="block text-xs text-slate-600">
          Gönderen İçerir
          <input
            value={newRuleFromPattern}
            onChange={(event) => setNewRuleFromPattern(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="ahmet@ / @tedarikci.com"
          />
        </label>
        <label className="block text-xs text-slate-600">
          Konu İçerir
          <input
            value={newRuleSubjectPattern}
            onChange={(event) => setNewRuleSubjectPattern(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="fatura / teklif"
          />
        </label>
        <label className="block text-xs text-slate-600">
          Durum Aksiyonu
          <select
            value={newRuleStateAction}
            onChange={(event) => setNewRuleStateAction(event.target.value as "none" | "ARCHIVED" | "TRASH" | "SPAM")}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="none">Yok</option>
            <option value="ARCHIVED">Arşivle</option>
            <option value="TRASH">Çöp Kutusuna Taşı</option>
            <option value="SPAM">Spam Olarak İşaretle</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          Eşleşince Yönlendir
          <input
            value={newRuleForwardTo}
            onChange={(event) => setNewRuleForwardTo(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="yonlendirme@firma.com"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={newRuleMarkRead}
            onChange={(event) => setNewRuleMarkRead(event.target.checked)}
          />
          Eşleşen maili okundu işaretle
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={newRuleStop}
            onChange={(event) => setNewRuleStop(event.target.checked)}
          />
          Bu kuraldan sonra diğer kuralları çalıştırma
        </label>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-60"
          disabled={mailPolicyPending}
          onClick={() => {
            void createFilterRule();
          }}
        >
          {mailPolicyPending ? "Kaydediliyor..." : "Filtre Kuralı Ekle"}
        </button>
        {filterRules.length === 0 ? (
          <p className="text-xs text-slate-500">Henüz filtre kuralı yok.</p>
        ) : (
          <ul className="space-y-2">
            {filterRules.map((rule) => (
              <li key={rule.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-800">
                    {rule.name} {rule.enabled ? "" : "(Pasif)"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-[11px] disabled:opacity-60"
                      disabled={mailPolicyPending}
                      onClick={() => {
                        void toggleFilterRule(rule);
                      }}
                    >
                      {rule.enabled ? "Pasifleştir" : "Aktifleştir"}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-rose-300 px-2 py-1 text-[11px] text-rose-700 disabled:opacity-60"
                      disabled={mailPolicyPending}
                      onClick={() => {
                        void deleteFilterRule(rule.id);
                      }}
                    >
                      Sil
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-slate-600">
                  Koşul: {rule.fromPattern ?? "-"} / {rule.subjectPattern ?? "-"} | Aksiyon:{" "}
                  {rule.actionState ?? "-"}
                  {rule.actionForwardTo ? ` | Yönlendir: ${rule.actionForwardTo}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">Engellenen / Beyaz / Kara Liste</h2>
        <p className="text-xs text-slate-600">
          Gönderen e-posta veya `@domain.com` ekleyerek beyaz liste (spamdan çıkar), kara liste veya engellenen
          gönderen davranışı tanımlayabilirsiniz.
        </p>
        <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
          <select
            value={newSenderKind}
            onChange={(event) => setNewSenderKind(event.target.value as SenderListKind)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="BLOCKED">Engellenen Gönderen</option>
            <option value="WHITELIST">Beyaz Liste</option>
            <option value="BLACKLIST">Kara Liste</option>
          </select>
          <input
            value={newSenderValue}
            onChange={(event) => setNewSenderValue(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="ornek@domain.com veya @domain.com"
          />
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-60"
            disabled={mailPolicyPending}
            onClick={() => {
              void addSenderListEntry();
            }}
          >
            Ekle
          </button>
        </div>
        {senderListEntries.length === 0 ? (
          <p className="text-xs text-slate-500">Henüz gönderen listesi kaydı yok.</p>
        ) : (
          <ul className="space-y-2">
            {senderListEntries.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-xs">
                <p className="text-slate-700">
                  {mapSenderKindLabel(entry.kind)}: <span className="font-medium">{entry.emailOrDomain}</span>
                </p>
                <button
                  type="button"
                  className="rounded border border-rose-300 px-2 py-1 text-[11px] text-rose-700 disabled:opacity-60"
                  disabled={mailPolicyPending}
                  onClick={() => {
                    void deleteSenderListEntry(entry.id);
                  }}
                >
                  Sil
                </button>
              </li>
            ))}
          </ul>
        )}
        {mailPolicyStatus ? <p className="text-xs text-slate-600">{mailPolicyStatus}</p> : null}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">MFA ve Session Güvenliği</h2>
        <p className="text-xs text-slate-600">MFA durumu: {mfaEnabled ? "Aktif" : "Pasif"}</p>

        {!mfaEnabled ? (
          <div className="space-y-2">
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs"
              onClick={() => {
                void startMfa();
              }}
            >
              MFA Kurulumu Başlat
            </button>

            {mfaSecret ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <p className="font-medium">Manuel Secret</p>
                <p className="mt-1 break-all font-mono">{mfaSecret}</p>
                {mfaOtpAuthUrl ? (
                  <a
                    href={mfaOtpAuthUrl}
                    className="mt-2 inline-block text-brand-700 underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    OTP URL Aç
                  </a>
                ) : null}
              </div>
            ) : null}

            {mfaEnrollmentToken ? (
              <div className="space-y-2">
                <input
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                  placeholder="6 haneli kod"
                  className="w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm tracking-[0.2em]"
                  inputMode="numeric"
                />
                <button
                  type="button"
                  className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white"
                  onClick={() => {
                    void verifyMfa();
                  }}
                >
                  MFA Doğrula ve Etkinleştir
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <input
              value={disableMfaCode}
              onChange={(event) => setDisableMfaCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              placeholder="MFA kapatma kodu"
              className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm tracking-[0.2em]"
              inputMode="numeric"
            />
            <button
              type="button"
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700"
              onClick={() => {
                void disableMfa();
              }}
            >
              MFA Devre Dışı Bırak
            </button>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-800">Cihaz / Session Listesi</h3>
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-[11px]"
              onClick={() => {
                void revokeOtherSessions();
              }}
            >
              Diğerlerini Sonlandır
            </button>
          </div>

          {sessions.length === 0 ? <p className="text-xs text-slate-500">Aktif session bulunamadı.</p> : null}

          <ul className="space-y-2 text-xs">
            {sessions.map((session) => (
              <li key={session.id} className="rounded border border-slate-100 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-slate-800">
                    {session.deviceName ?? "Unknown Device"}
                    {session.isCurrent ? " (Mevcut)" : ""}
                  </p>
                  {!session.isCurrent ? (
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-[11px]"
                      onClick={() => {
                        void revokeSession(session.id);
                      }}
                    >
                      Sonlandır
                    </button>
                  ) : null}
                </div>
                <p className="mt-1 text-slate-600">IP: {session.ipAddress ?? "-"}</p>
                <p className="text-slate-600">MFA: {session.mfaVerifiedAt ? "Doğrulandı" : "Yok"}</p>
                <p className="text-slate-500">Oluşturulma: {new Date(session.createdAt).toLocaleString("tr-TR")}</p>
                <p className="text-slate-500">Sona eriş: {new Date(session.expiresAt).toLocaleString("tr-TR")}</p>
              </li>
            ))}
          </ul>
        </div>

        {securityStatus ? <p className="text-xs text-slate-600">{securityStatus}</p> : null}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">KVKK / GDPR</h2>
        <p className="text-xs text-slate-600">
          Kişisel verilerinizi JSON formatında dışa aktarabilir veya silme talebi oluşturabilirsiniz.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={privacyExportPending}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs disabled:opacity-60"
            onClick={() => {
              void exportPrivacyData();
            }}
          >
            {privacyExportPending ? "Hazırlanıyor..." : "Verilerimi Dışa Aktar"}
          </button>
        </div>
        <label className="block text-xs text-slate-600">
          Silme talebi nedeni (opsiyonel)
          <textarea
            value={privacyEraseReason}
            onChange={(event) => setPrivacyEraseReason(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Talebinize ek not bırakabilirsiniz."
          />
        </label>
        <button
          type="button"
          disabled={privacyErasePending}
          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 disabled:opacity-60"
          onClick={() => {
            void requestPrivacyErase();
          }}
        >
          {privacyErasePending ? "İşleniyor..." : "Silme Talebi Oluştur"}
        </button>
        {privacyStatus ? <p className="text-xs text-slate-600">{privacyStatus}</p> : null}
      </section>
    </div>
  );
}

function parseRecipientList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function mapSenderKindLabel(kind: SenderListKind): string {
  if (kind === "WHITELIST") {
    return "Beyaz Liste";
  }

  if (kind === "BLACKLIST") {
    return "Kara Liste";
  }

  return "Engellenen";
}

function plainTextToHtml(value: string): string {
  if (value.trim().length === 0) {
    return "";
  }

  return escapeHtml(value).replace(/\n/g, "<br/>");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
