function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function exportToDocx(html: string) {
  const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  const blob = new Blob([wrappedHtml], {
    type: 'application/msword',
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  triggerDownload(blob, `dokuman-${timestamp}.doc`);
}
