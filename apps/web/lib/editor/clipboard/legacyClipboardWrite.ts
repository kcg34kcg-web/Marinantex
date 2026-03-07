export interface LegacyClipboardWriteRequest {
  plainText: string;
  html?: string;
  custom?: {
    mime: string;
    value: string;
  };
}

export interface LegacyClipboardWriteResult {
  ok: boolean;
  plainTextWritten: boolean;
  htmlWritten: boolean;
  customWritten: boolean;
}

interface MinimalClipboardData {
  setData: (type: string, value: string) => void;
}

function writeIfPossible(
  data: MinimalClipboardData | null,
  type: string,
  value: string,
): boolean {
  if (!data) {
    return false;
  }
  try {
    data.setData(type, value);
    return true;
  } catch {
    return false;
  }
}

export function legacyClipboardWrite(
  request: LegacyClipboardWriteRequest,
): LegacyClipboardWriteResult {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    return {
      ok: false,
      plainTextWritten: false,
      htmlWritten: false,
      customWritten: false,
    };
  }

  let plainTextWritten = false;
  let htmlWritten = false;
  let customWritten = false;

  const textarea = document.createElement("textarea");
  textarea.value = request.plainText || "";
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.left = "-10000px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  if (typeof textarea.setSelectionRange === "function") {
    textarea.setSelectionRange(0, textarea.value.length);
  }

  const onCopy = (event: ClipboardEvent) => {
    const clipboardData = (event.clipboardData ?? null) as MinimalClipboardData | null;
    plainTextWritten = writeIfPossible(clipboardData, "text/plain", request.plainText);

    if (request.html) {
      htmlWritten = writeIfPossible(clipboardData, "text/html", request.html);
    }

    if (request.custom) {
      customWritten = writeIfPossible(
        clipboardData,
        request.custom.mime,
        request.custom.value,
      );
    }

    if (clipboardData) {
      event.preventDefault();
    }
  };

  document.addEventListener("copy", onCopy);

  let success = false;
  try {
    success = document.execCommand("copy");
  } catch {
    success = false;
  } finally {
    document.removeEventListener("copy", onCopy);
    textarea.remove();
  }

  return {
    ok: success,
    plainTextWritten: success ? true : plainTextWritten,
    htmlWritten,
    customWritten,
  };
}
