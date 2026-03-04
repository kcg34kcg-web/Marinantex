'use client';

import { useEffect, useState } from "react";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { getDebateFeed, type Debate } from "@/app/actions/debate";
import DebateCard from "./DebateCard";
import { Button } from "@/components/ui/button";

export default function DebateList() {
  const [debates, setDebates] = useState<Debate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDebates = async () => {
    setLoading(true);
    setError(null);
    try {
        const data = await getDebateFeed(0, 20); // İlk 20 taneyi getir
        setDebates(data);
    } catch (err) {
        console.error(err);
        setError("Münazaralar yüklenirken bir hata oluştu.");
    } finally {
        setLoading(false);
    }
  };

  // Bileşen yüklendiğinde veriyi çek
  useEffect(() => {
    fetchDebates();
  }, []);

  if (loading) {
    return (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <Loader2 className="w-10 h-10 text-slate-300 animate-spin" />
            <p className="text-slate-400 text-sm animate-pulse">Arena hazırlanıyor...</p>
        </div>
    );
  }

  if (error) {
    return (
        <div className="text-center py-10 bg-red-50 rounded-xl border border-red-100">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-red-600 font-medium mb-4">{error}</p>
            <Button onClick={fetchDebates} variant="outline" className="border-red-200 text-red-600 hover:bg-red-100">
                <RefreshCw size={16} className="mr-2" /> Tekrar Dene
            </Button>
        </div>
    );
  }

  if (debates.length === 0) {
      return (
        <div className="text-center py-16 px-4">
            <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="text-slate-400" size={32} />
            </div>
            <h3 className="text-slate-900 font-bold text-lg">Henüz Münazara Yok</h3>
            <p className="text-slate-500 text-sm max-w-xs mx-auto mt-2">
                Ortalık çok sessiz. İlk kıvılcımı sen çakmak ister misin?
            </p>
        </div>
      );
  }

  return (
    <div className="space-y-6">
      {debates.map((debate) => (
         <DebateCard key={debate.id} debate={debate} />
      ))}
      
      <div className="text-center pt-6 pb-10">
          <p className="text-xs text-slate-400 font-medium">Şimdilik bu kadar.</p>
      </div>
    </div>
  );
}