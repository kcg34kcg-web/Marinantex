"use client";

import EditorUnified from "./editor-unified";

interface EditorShellProps {
  documentId: string;
}

export function EditorShell({ documentId }: EditorShellProps) {
  return <EditorUnified documentId={documentId} layout="full" />;
}

