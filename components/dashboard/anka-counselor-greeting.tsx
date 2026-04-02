'use client';

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, MessageSquare, Send, X } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';
import { cn } from '@/lib/utils';

type ReplyTone = 'great' | 'okay' | 'hard';
type ScaleAccentMode = ReplyTone | 'reset';
type ChatRole = 'user' | 'assistant';

interface ReplyOption {
  tone: ReplyTone;
  label: string;
  response: string;
}

interface ChatMessage {
  role: ChatRole;
  content: string;
}

const DISMISS_KEY = 'marinantex.dashboard.scale.dismissedDate';
const DASHBOARD_CHAT_CONVERSATION_KEY = 'marinantex.dashboard.greeting.conversationId.v1';

const REPLY_OPTIONS: ReplyOption[] = [
  {
    tone: 'great',
    label: 'Harikayım',
    response: 'Harika. Bugünün temposunu yüksek tutalım ve kritik işlere güçlü başlayalım.',
  },
  {
    tone: 'okay',
    label: 'İdare eder',
    response: 'Tamamdır. Akışı sadeleştirip öncelikleri net bir sıraya koyalım.',
  },
  {
    tone: 'hard',
    label: 'Zorlanıyorum',
    response: 'Yanındayım. Önce baskıyı azaltan küçük adımlarla ilerleyelim.',
  },
];

function getToneIconPalette(accentMode: ScaleAccentMode): { color: string; glow: string; filter: string } {
  if (accentMode === 'great') {
    return {
      color: '#059669',
      glow: 'rgba(5, 150, 105, 0.30)',
      filter: 'hue-rotate(78deg) saturate(1.5) brightness(1.02)',
    };
  }

  if (accentMode === 'hard') {
    return {
      color: '#dc2626',
      glow: 'rgba(220, 38, 38, 0.30)',
      filter: 'hue-rotate(292deg) saturate(1.5) brightness(0.98)',
    };
  }

  if (accentMode === 'okay') {
    return {
      color: '#2563eb',
      glow: 'rgba(37, 99, 235, 0.30)',
      filter: 'hue-rotate(28deg) saturate(1.45) brightness(1.03)',
    };
  }

  return {
    color: 'var(--primary)',
    glow: 'rgba(31, 111, 235, 0.22)',
    filter: 'none',
  };
}

function LegalScaleLogo({ accentMode, motionSeed }: { accentMode: ScaleAccentMode; motionSeed: number }) {
  const palette = getToneIconPalette(accentMode);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    let rafId = 0;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const t = (now - startedAt) / 1000;

      let tx = 0;
      let ty = 0;
      let rot = 0;
      let scale = 1;
      let glowScale = 1;
      let glowOpacity = 0.58;

      if (accentMode === 'great') {
        ty = -Math.abs(Math.sin(t * 5.8)) * 7.5;
        rot = Math.sin(t * 7.5) * 9;
        scale = 1 + Math.abs(Math.sin(t * 5.8)) * 0.14;
        glowScale = 1.05 + Math.abs(Math.sin(t * 5.8)) * 0.25;
        glowOpacity = 0.5 + Math.abs(Math.sin(t * 5.8)) * 0.4;
      } else if (accentMode === 'okay') {
        tx = Math.sin(t * 3.6) * 3.5;
        ty = Math.sin(t * 7.2) * 2;
        rot = Math.sin(t * 2.8) * 3.5;
        scale = 1 + Math.abs(Math.sin(t * 3.6)) * 0.08;
        glowScale = 1 + Math.abs(Math.sin(t * 3.6)) * 0.18;
        glowOpacity = 0.46 + Math.abs(Math.sin(t * 3.6)) * 0.32;
      } else if (accentMode === 'hard') {
        tx = Math.sin(t * 16) * 2.6;
        ty = Math.sin(t * 8) * 1.3;
        rot = Math.sin(t * 13) * 2.2;
        scale = 1 + Math.abs(Math.sin(t * 6.5)) * 0.1;
        glowScale = 1 + Math.abs(Math.sin(t * 6.5)) * 0.22;
        glowOpacity = 0.5 + Math.abs(Math.sin(t * 6.5)) * 0.38;
      } else {
        ty = Math.sin(t * 2.4) * 1.8;
        rot = Math.sin(t * 2.4) * 2;
        scale = 1 + Math.abs(Math.sin(t * 2.4)) * 0.04;
        glowScale = 1 + Math.abs(Math.sin(t * 2.4)) * 0.14;
        glowOpacity = 0.4 + Math.abs(Math.sin(t * 2.4)) * 0.2;
      }

      if (containerRef.current) {
        containerRef.current.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(${rot}deg) scale(${scale})`;
      }

      if (glowRef.current) {
        glowRef.current.style.transform = `scale(${glowScale})`;
        glowRef.current.style.opacity = String(glowOpacity);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [accentMode, motionSeed]);

  return (
    <div
      ref={containerRef}
      className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{ border: `1px solid ${palette.color}35`, willChange: 'transform' }}
    >
      <span
        ref={glowRef}
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, ${palette.glow} 0%, rgba(31,111,235,0) 72%)`,
          transformOrigin: 'center',
          willChange: 'transform,opacity',
        }}
      />
      <div className="relative z-[1] h-8 w-8" style={{ filter: palette.filter }}>
        <Logo width={42} height={42} className="h-8 w-auto" />
      </div>
    </div>
  );
}

export function AnkaCounselorGreeting({ className }: { className?: string }) {
  const [selectedTone, setSelectedTone] = useState<ReplyTone | null>(null);
  const [accentMode, setAccentMode] = useState<ScaleAccentMode>('reset');
  const [isDismissed, setIsDismissed] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [logoMotionSeed, setLogoMotionSeed] = useState(0);

  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const hydratedConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasLegacyDismiss = window.localStorage.getItem(DISMISS_KEY);
    if (hasLegacyDismiss) {
      window.localStorage.removeItem(DISMISS_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedConversationId = window.localStorage.getItem(DASHBOARD_CHAT_CONVERSATION_KEY);
    if (storedConversationId) {
      setConversationId(storedConversationId);
    }
  }, []);

  useEffect(() => {
    if (!conversationId) {
      hydratedConversationIdRef.current = null;
      return;
    }

    if (hydratedConversationIdRef.current === conversationId) {
      return;
    }
    hydratedConversationIdRef.current = conversationId;

    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/assistant/conversations/${conversationId}`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Geçmiş mesajlar alınamadı.');
        }
        const payload = (await response.json()) as {
          messages?: Array<{ role?: 'user' | 'assistant' | 'system'; content?: string }>;
        };
        if (cancelled) {
          return;
        }

        const restored = (payload.messages ?? [])
          .filter((item) => item.role === 'user' || item.role === 'assistant')
          .map((item) => ({
            role: item.role as 'user' | 'assistant',
            content: item.content ?? '',
          }))
          .filter((item) => item.content.trim().length > 0)
          .slice(-40);

        setChatMessages(restored);
      } catch {
        if (!cancelled && typeof window !== 'undefined') {
          window.localStorage.removeItem(DASHBOARD_CHAT_CONVERSATION_KEY);
          setConversationId(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const selected = useMemo(() => REPLY_OPTIONS.find((item) => item.tone === selectedTone) ?? null, [selectedTone]);
  const canSendChat = chatInput.trim().length > 0 && !isChatLoading;
  const tonePalette = getToneIconPalette(accentMode);

  const title = selected ? selected.response : 'Bugün nasılsın? Cevabına göre odağımı senin için ayarlayabilirim.';
  const moodLabel = selectedTone === 'great' ? 'Yüksek enerji' : selectedTone === 'hard' ? 'Destek modu' : 'Dengeli mod';

  const handleSendChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = chatInput.trim();

    if (!content || isChatLoading) {
      return;
    }

    setIsChatOpen(true);
    setChatInput('');
    setChatError(null);
    setChatMessages((prev) => [...prev, { role: 'user', content }]);
    setIsChatLoading(true);

    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId: conversationId ?? undefined,
          message: content,
          routeContext: {
            pathname: typeof window !== 'undefined' ? window.location.pathname : '/dashboard',
            section: 'dashboard',
            focus: 'greeting_card_chat',
            entityType: 'dashboard_card',
            entityId: 'anka_counselor_greeting',
            focusType: 'general',
            queryHints: [selectedTone ? `mood:${selectedTone}` : 'mood:unknown', 'wellbeing', 'dashboard'],
          },
          stream: false,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
        conversationId?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? 'Sohbet servisi şu anda yanıt veremiyor.');
      }

      if (payload.conversationId) {
        setConversationId(payload.conversationId);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(DASHBOARD_CHAT_CONVERSATION_KEY, payload.conversationId);
        }
      }

      const reply = payload.reply?.trim();
      if (!reply) {
        throw new Error('Asistandan boş yanıt geldi. Lütfen tekrar dener misin?');
      }

      setChatMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Beklenmeyen bir sohbet hatası oluştu.');
    } finally {
      setIsChatLoading(false);
    }
  };

  if (isDismissed) {
    return (
      <section className={cn('flex justify-end', className)}>
        <button
          type="button"
          onClick={() => setIsDismissed(false)}
          className="inline-flex items-center rounded-full border border-[#c9d8e6] bg-white/85 px-4 py-2 text-xs font-semibold tracking-[0.01em] text-[#3f607e] shadow-[0_10px_22px_-20px_rgba(15,42,67,0.7)] transition-colors hover:border-[#adc2d7] hover:text-[#1f4360]"
        >
          Amblemi tekrar göster
        </button>
      </section>
    );
  }

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-[22px] border border-[#d9e4ee] bg-[#f9fcff] shadow-[0_20px_44px_-40px_rgba(15,23,42,0.95)]',
        className,
      )}
    >
      <span className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-[radial-gradient(circle,#d9eaff_0%,transparent_72%)]" />
      <span className="pointer-events-none absolute -bottom-20 -left-12 h-40 w-40 rounded-full bg-[radial-gradient(circle,#c8f1e2_0%,transparent_74%)]" />

      <div className="relative z-[1] border-b border-[#dee8f2] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <LegalScaleLogo accentMode={accentMode} motionSeed={logoMotionSeed} />

            <div className="space-y-1.5">
              <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[#d8e4f0] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.11em] text-[#3f607c]">
                <span
                  key={`badge-logo-${accentMode}-${logoMotionSeed}`}
                  className="inline-flex h-3.5 w-3.5 items-center justify-center"
                  style={{ filter: tonePalette.filter }}
                >
                  <Logo width={20} height={20} className="h-3.5 w-auto" />
                </span>
                Babylexit Asistan
              </p>
              <h2 className="font-serif text-xl leading-tight tracking-[-0.012em] text-[#0f2a43] sm:text-2xl">Merhaba, ben Babylexit Asistan.</h2>
              <p className="max-w-2xl text-[13px] leading-relaxed text-[#3f556a]">{title}</p>
              <p
                className="inline-flex items-center rounded-full border bg-white/90 px-2.5 py-1 text-[11px] font-semibold"
                style={{ borderColor: `${tonePalette.color}4d`, color: tonePalette.color }}
              >
                Durum: {moodLabel}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#d7e0ea] bg-white/90 text-[#6f8498] transition-colors hover:border-[#becdde] hover:text-[#38546f]"
            aria-label="Kartı kapat"
            title="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative z-[1] space-y-3 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        <div className="flex flex-wrap items-center gap-2">
          {REPLY_OPTIONS.map((option) => (
            <button
              key={option.tone}
              type="button"
              onClick={() => {
                setSelectedTone(option.tone);
                setAccentMode(option.tone);
                setLogoMotionSeed((previous) => previous + 1);
              }}
              className={cn(
                'inline-flex items-center rounded-full border px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.01em] transition-all',
                selectedTone === option.tone
                  ? option.tone === 'great'
                    ? 'border-[#86efac] bg-white text-[#059669] shadow-[0_10px_24px_-22px_rgba(5,150,105,0.9)]'
                    : option.tone === 'okay'
                      ? 'border-[#93c5fd] bg-white text-[#2563eb] shadow-[0_10px_24px_-22px_rgba(37,99,235,0.95)]'
                      : 'border-[#fca5a5] bg-white text-[#dc2626] shadow-[0_10px_24px_-22px_rgba(220,38,38,0.85)]'
                  : 'border-[#d3dce7] bg-white/80 text-[#3f556a] hover:border-[#b9c9d9] hover:bg-white',
              )}
              aria-pressed={selectedTone === option.tone}
            >
              {option.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => {
              setSelectedTone(null);
              setAccentMode('reset');
              setLogoMotionSeed((previous) => previous + 1);
            }}
            className="inline-flex items-center rounded-full border border-[#d3dce7] bg-transparent px-3 py-1.5 text-[11px] font-semibold text-[#5b7085] transition-colors hover:border-[#bccbd9] hover:text-[#324c66]"
          >
            Yeniden sor
          </button>
        </div>

        <div className="ml-auto w-full max-w-md">
          <button
            type="button"
            onClick={() => setIsChatOpen((prev) => !prev)}
            className="inline-flex w-full items-center justify-between rounded-xl border border-[#d8e3ef] bg-white/95 px-3 py-2 text-xs font-semibold text-[#45627c] transition-colors hover:border-[#bfd1e3]"
          >
            <span className="inline-flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[#2563eb]" />
              Mini Sohbet {chatMessages.length > 0 ? `(${chatMessages.length})` : ''}
            </span>
            {isChatOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {isChatOpen ? (
            <div className="mt-2 rounded-xl border border-[#d8e3ef] bg-white/95 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
              <div className="mb-2 max-h-32 space-y-2 overflow-y-auto pr-1">
                {chatMessages.length === 0 ? (
                  <p className="text-xs text-[#5f7488]">Kısa bir mesaj yaz, sohbet başlasın.</p>
                ) : (
                  chatMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={cn(
                        'max-w-[90%] rounded-2xl px-3 py-1.5 text-xs leading-relaxed',
                        message.role === 'user'
                          ? 'ml-auto rounded-br-md bg-[#eff6ff] text-[#1e3a5f]'
                          : 'mr-auto rounded-bl-md border border-[#e2e8f0] bg-[#f8fafc] text-[#334155]',
                      )}
                    >
                      {message.content}
                    </div>
                  ))
                )}

                {isChatLoading ? (
                  <div className="mr-auto inline-flex items-center gap-1 rounded-2xl rounded-bl-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-xs text-[#64748b]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Yazıyor...
                  </div>
                ) : null}
              </div>

              <form onSubmit={handleSendChat} className="flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder="Mesaj..."
                  className="h-9 flex-1 rounded-lg border border-[#d5e0ec] bg-white px-3 text-xs text-[#12314c] outline-none transition-colors focus:border-[#93c5fd]"
                  maxLength={500}
                />
                <button
                  type="submit"
                  disabled={!canSendChat}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#d5e0ec] bg-white text-[#2563eb] transition-colors hover:border-[#93c5fd] hover:text-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Mesajı gönder"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>

              {chatError ? <p className="mt-2 text-xs text-[#dc2626]">{chatError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
