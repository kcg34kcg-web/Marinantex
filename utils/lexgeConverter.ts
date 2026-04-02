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

export function saveAsLexge(payload: unknown) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], {
    type: 'application/json',
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  triggerDownload(blob, `taslak-${timestamp}.lexge.json`);
}
