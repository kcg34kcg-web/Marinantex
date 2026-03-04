"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  createPublicShareComment,
  resolvePublicShare,
} from "@/lib/editor/api-client";

interface CommentItem {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export default function SharedDocumentPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";

  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [permission, setPermission] = useState<"VIEW" | "COMMENT">("VIEW");
  const [documentTitle, setDocumentTitle] = useState("Paylasilan Belge");
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [authorName, setAuthorName] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }

    void resolvePublicShare(token)
      .then((payload) => {
        setPreviewHtml(payload.previewHtml);
        setPermission(payload.shareLink.permission);
        setDocumentTitle(payload.document.title);
        setComments(payload.comments);
      })
      .catch(() => {
        setError("Paylasim linki gecersiz veya suresi dolmus.");
      });
  }, [token]);

  const handleComment = async () => {
    if (!token || permission !== "COMMENT") {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const comment = await createPublicShareComment(token, { authorName, body });
      setComments((prev) => [...prev, comment]);
      setAuthorName("");
      setBody("");
    } catch {
      setError("Yorum gonderilemedi.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-8">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h1 className="text-xl font-bold text-slate-900">{documentTitle}</h1>
        <p className="mt-1 text-xs text-slate-500">Paylasim izin tipi: {permission}</p>
        {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-slate-100 p-3">
        <iframe
          title="Shared Document Preview"
          className="min-h-[950px] w-full rounded-lg border border-slate-300 bg-white"
          srcDoc={previewHtml}
        />
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Yorumlar</h2>
        {comments.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">Yorum bulunmuyor.</p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="mt-2 rounded-md border border-slate-200 p-2">
              <p className="text-xs font-semibold text-slate-800">{comment.authorName}</p>
              <p className="mt-1 text-sm text-slate-700">{comment.body}</p>
            </div>
          ))
        )}

        {permission === "COMMENT" ? (
          <div className="mt-3 space-y-2">
            <input
              value={authorName}
              onChange={(event) => setAuthorName(event.target.value)}
              placeholder="Ad Soyad"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Yorumunuz"
              className="min-h-[100px] w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                void handleComment();
              }}
              disabled={saving || authorName.trim().length < 2 || body.trim().length < 2}
              className="rounded-md border border-brand-600 px-3 py-1.5 text-sm font-semibold text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Gonderiliyor..." : "Yorum Gonder"}
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
