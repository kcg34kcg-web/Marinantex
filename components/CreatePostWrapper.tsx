"use client";

import { useState, useEffect } from "react";
import { Image as ImageIcon, Send, X } from "lucide-react";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import { createClient } from "@/utils/supabase/client";
import toast from "react-hot-toast";

export default function CreatePostWrapper() {
  const router = useRouter();
  const supabase = createClient();
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUser(data.user);
    };
    getUser();
  }, [supabase]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setPreviewUrl(URL.createObjectURL(selectedFile));
    }
  };

  const handlePost = async () => {
    if (!content && !file) return;
    if (!user) return toast.error("Paylaşım yapmak için giriş yapmalısınız.");
    
    setLoading(true);

    try {
      let imageUrl = null;

      if (file) {
        const options = { maxSizeMB: 0.2, maxWidthOrHeight: 1080 };
        const compressedFile = await imageCompression(file, options);
        const fileName = `${user.id}/${Date.now()}.webp`;
        const { error: uploadError } = await supabase.storage
          .from("post-attachments")
          .upload(fileName, compressedFile);
        
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from("post-attachments").getPublicUrl(fileName);
        imageUrl = data.publicUrl;
      }

      const { error } = await supabase.from("posts").insert({
        user_id: user.id,
        content: content,
        image_url: imageUrl,
        category: "teori"
      });

      if (error) throw error;
      
      // Formu temizle
      setContent("");
      setFile(null);
      setPreviewUrl(null);
      
      toast.success("Kürsüde paylaşıldı!");
      
      // Akışı anında yenilemek için
      router.refresh();
      
    } catch (error: any) {
      console.error(error);
      toast.error("Paylaşım başarısız: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-2xl">
      <div className="flex gap-4">
        <div className="w-10 h-10 bg-amber-600 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-white">
          {user?.email?.charAt(0).toUpperCase() || "B"}
        </div>
        <div className="flex-1 space-y-3">
          <textarea 
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Hukuki bir analiz paylaş veya bir mesele ortaya at..."
            className="w-full bg-transparent border-none outline-none resize-none text-slate-200 placeholder:text-slate-600 min-h-[80px]"
          />
          
          {previewUrl && (
            <div className="relative rounded-xl overflow-hidden border border-slate-800">
              <button 
                onClick={() => {setFile(null); setPreviewUrl(null);}}
                className="absolute top-2 right-2 bg-black/50 p-1 rounded-full hover:bg-black text-white"
              >
                <X size={16} />
              </button>
              <img src={previewUrl} alt="Preview" className="w-full max-h-80 object-cover" />
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-800 pt-3">
            <label className="cursor-pointer text-amber-500 hover:bg-amber-500/10 p-2 rounded-full transition-all">
              <ImageIcon size={20} />
              <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
            </label>
            <button 
              onClick={handlePost}
              disabled={loading || (!content && !file)}
              className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 px-6 py-1.5 rounded-full font-bold flex items-center gap-2 transition-all shadow-lg shadow-amber-500/10"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <><Send size={16} /> Paylaş</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}