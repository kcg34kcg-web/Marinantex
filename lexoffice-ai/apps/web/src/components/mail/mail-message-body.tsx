"use client";

import { useEffect, useMemo, useState } from "react";

type MessageBodyMode = "html" | "text";

export function MailMessageBody({
  bodyText,
  bodyHtml
}: {
  bodyText: string | null;
  bodyHtml: string | null;
}) {
  const hasHtml = (bodyHtml ?? "").trim().length > 0;
  const [mode, setMode] = useState<MessageBodyMode>(hasHtml ? "html" : "text");
  const [showImages, setShowImages] = useState(true);
  const [allowExternalContent, setAllowExternalContent] = useState(false);

  const sanitized = useMemo(
    () =>
      sanitizeMailHtml(bodyHtml ?? "", {
        showImages,
        allowExternalContent
      }),
    [allowExternalContent, bodyHtml, showImages]
  );

  useEffect(() => {
    if (!hasHtml) {
      setMode("text");
    }
  }, [hasHtml]);

  return (
    <div className="space-y-2">
      {hasHtml ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`rounded border px-2 py-1 text-xs ${
              mode === "html" ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-300 bg-white"
            }`}
            onClick={() => setMode("html")}
          >
            HTML
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-1 text-xs ${
              mode === "text" ? "border-orange-300 bg-orange-50 text-orange-700" : "border-slate-300 bg-white"
            }`}
            onClick={() => setMode("text")}
          >
            Düz Metin
          </button>

          {mode === "html" ? (
            <>
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                onClick={() => setShowImages((current) => !current)}
              >
                {showImages ? "Resimleri Gizle" : "Resimleri Göster"}
              </button>
              <button
                type="button"
                className={`rounded border px-2 py-1 text-xs ${
                  allowExternalContent
                    ? "border-amber-400 bg-amber-50 text-amber-700"
                    : "border-slate-300 bg-white"
                }`}
                onClick={() => setAllowExternalContent((current) => !current)}
              >
                {allowExternalContent ? "Harici İçerik Açık" : "Harici İçeriği Güvenli Yükle"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {mode === "html" && hasHtml ? (
        <div className="max-h-[540px] overflow-auto rounded-lg border border-slate-200 bg-white p-3">
          <div
            className="[&_a]:text-blue-700 [&_a[data-link-risk='true']]:font-medium [&_a[data-link-risk='true']]:text-rose-700 [&_a[data-link-risk='true']]:underline [&_img]:h-auto [&_img]:max-w-full [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:p-1 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:p-1 [&_ul]:list-disc [&_ul]:pl-6"
            dangerouslySetInnerHTML={{ __html: sanitized.html }}
          />
        </div>
      ) : (
        <pre className="max-h-[540px] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {(bodyText ?? "").trim().length > 0 ? bodyText : "İçerik yok"}
        </pre>
      )}

      {mode === "html" && hasHtml && !allowExternalContent && sanitized.blockedExternalImages > 0 ? (
        <p className="text-xs text-amber-700">
          {sanitized.blockedExternalImages} harici görsel güvenlik için engellendi. Gerekirse
          “Harici İçeriği Güvenli Yükle” butonunu açın.
        </p>
      ) : null}
      {mode === "html" && hasHtml && sanitized.riskyLinks > 0 ? (
        <p className="text-xs text-rose-700">
          {sanitized.riskyLinks} bağlantı potansiyel riskli işaretlendi
          {sanitized.insecureLinks > 0 ? ` (${sanitized.insecureLinks} tanesi HTTP).` : "."}
        </p>
      ) : null}
    </div>
  );
}

function sanitizeMailHtml(
  rawHtml: string,
  options: { showImages: boolean; allowExternalContent: boolean }
): { html: string; blockedExternalImages: number; riskyLinks: number; insecureLinks: number } {
  if (rawHtml.trim().length === 0) {
    return {
      html: "",
      blockedExternalImages: 0,
      riskyLinks: 0,
      insecureLinks: 0
    };
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(rawHtml, "text/html");
  const blockedSelectors = ["script", "style", "link", "meta", "base", "iframe", "object", "embed"];

  for (const selector of blockedSelectors) {
    for (const node of Array.from(documentNode.querySelectorAll(selector))) {
      node.remove();
    }
  }

  for (const element of Array.from(documentNode.body.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();

      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if ((name === "src" || name === "href" || name === "xlink:href") && value.startsWith("javascript:")) {
        element.removeAttribute(attribute.name);
      }
    }

    const styleValue = element.getAttribute("style");
    if (styleValue && /url\s*\(/i.test(styleValue)) {
      element.removeAttribute("style");
    }
  }

  let riskyLinks = 0;
  let insecureLinks = 0;

  for (const anchor of Array.from(documentNode.body.querySelectorAll("a"))) {
    const href = anchor.getAttribute("href");
    if (!href) {
      continue;
    }

    if (!isSafeLink(href)) {
      anchor.removeAttribute("href");
      continue;
    }

    if (href.startsWith("http://") || href.startsWith("https://")) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer nofollow");
    }

    const linkRisk = evaluateLinkRisk(href, anchor.textContent ?? "");
    if (linkRisk.risky) {
      riskyLinks += 1;
      if (linkRisk.insecure) {
        insecureLinks += 1;
      }
      anchor.setAttribute("data-link-risk", "true");
      anchor.setAttribute("title", "Bu bağlantı güvenlik açısından riskli olabilir.");
    }
  }

  let blockedExternalImages = 0;

  for (const image of Array.from(documentNode.body.querySelectorAll("img"))) {
    const src = image.getAttribute("src");
    const isExternal = isExternalResource(src);

    if (!options.showImages) {
      image.remove();
      continue;
    }

    if (isExternal && !options.allowExternalContent) {
      blockedExternalImages += 1;
      image.removeAttribute("src");
      image.setAttribute("alt", image.getAttribute("alt") ?? "Harici görsel engellendi");
      image.setAttribute("title", "Harici görsel engellendi");
      image.setAttribute("data-external-blocked", "true");
    }

    const styleValue = image.getAttribute("style");
    const nextStyle = styleValue
      ? `${styleValue};max-width:100%;height:auto;`
      : "max-width:100%;height:auto;";
    image.setAttribute("style", nextStyle);
    image.setAttribute("loading", "lazy");
  }

  return {
    html: documentNode.body.innerHTML,
    blockedExternalImages,
    riskyLinks,
    insecureLinks
  };
}

function isExternalResource(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

function isSafeLink(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("#")
  );
}

function evaluateLinkRisk(
  href: string,
  visibleText: string
): {
  risky: boolean;
  insecure: boolean;
} {
  const trimmed = href.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return { risky: false, insecure: false };
  }

  try {
    const url = new URL(trimmed);
    const insecure = url.protocol === "http:";
    const punycodeHost = url.hostname.includes("xn--");
    const ipHost = isIpv4Host(url.hostname);
    const hasUserInfo = url.username.trim().length > 0;
    const displayHost = extractHostFromText(visibleText);
    const hostMismatch =
      displayHost !== null && normalizeHost(displayHost) !== normalizeHost(url.hostname);
    const risky = insecure || punycodeHost || ipHost || hasUserInfo || hostMismatch;

    return {
      risky,
      insecure
    };
  } catch {
    return { risky: true, insecure: false };
  }
}

function extractHostFromText(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withProtocol).hostname;
  } catch {
    return null;
  }
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

function isIpv4Host(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}
