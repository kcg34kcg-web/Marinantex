"use client";

import { EditorContent, type Editor } from "@tiptap/react";

interface A4EditorCanvasProps {
  editor: Editor | null;
  mode: "edit" | "preview";
  previewHtml?: string | null;
  previewLoading?: boolean;
}

export function A4EditorCanvas({
  editor,
  mode,
  previewHtml,
  previewLoading = false,
}: A4EditorCanvasProps) {
  const showPreview = mode === "preview";

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-200/70 p-6">
      <div className="mx-auto w-full max-w-[794px]">
        <div
          className={[
            "editor-a4-paper relative min-h-[1123px] bg-white shadow-[0_8px_30px_rgba(15,23,42,0.12)]",
            showPreview ? "ring-2 ring-brand-100" : "",
          ].join(" ")}
        >
          <div className="border-b border-slate-100 px-10 py-2 text-xs font-medium text-slate-500">
            {showPreview ? "Print Preview Mode" : "Edit Mode"}
          </div>
          <div className="px-10 py-8">
            {showPreview ? (
              previewLoading ? (
                <p className="text-sm text-slate-500">Print preview yukleniyor...</p>
              ) : previewHtml ? (
                <iframe
                  title="Print Preview"
                  className="min-h-[940px] w-full border-0"
                  srcDoc={previewHtml}
                />
              ) : (
                <p className="text-sm text-slate-500">Print preview olusturulamadi.</p>
              )
            ) : editor ? (
              <EditorContent editor={editor} />
            ) : (
              <p className="text-sm text-slate-500">Editor yukleniyor...</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
