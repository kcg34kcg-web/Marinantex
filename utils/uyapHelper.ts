interface MinimalEditor {
  getText?: () => string;
  getHTML?: () => string;
}

export async function copyToClipboardMultiMime(editor: MinimalEditor): Promise<boolean> {
  try {
    const plainText = typeof editor.getText === 'function' ? editor.getText() : '';
    const htmlText = typeof editor.getHTML === 'function' ? editor.getHTML() : '';
    const fallback = plainText || htmlText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(fallback);
      return true;
    }

    const textarea = document.createElement('textarea');
    textarea.value = fallback;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand('copy');
    textarea.remove();
    return success;
  } catch {
    return false;
  }
}
