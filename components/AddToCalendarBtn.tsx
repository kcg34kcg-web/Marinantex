'use client';

import { CalendarPlus, Check } from 'lucide-react';
import { addHours, isPast, isToday } from 'date-fns';
import { useState } from 'react';
import { cn } from '@/utils/cn';

interface AddToCalendarBtnProps {
  eventTitle: string;
  eventDate: string | Date;
  locationName?: string | null;
}

export default function AddToCalendarBtn({ eventTitle, eventDate, locationName }: AddToCalendarBtnProps) {
  const [clicked, setClicked] = useState(false);
  const dateObj = new Date(eventDate);
  const isEnded = isPast(dateObj) && !isToday(dateObj);

  if (isEnded) return null; 

  const handleAddToCalendar = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Google Calendar Link Formatı
    const formatDate = (date: Date) => date.toISOString().replace(/-|:|\.\d\d\d/g, "");
    const start = formatDate(dateObj);
    const end = formatDate(addHours(dateObj, 2));

    const url = new URL("https://www.google.com/calendar/render");
    url.searchParams.append("action", "TEMPLATE");
    url.searchParams.append("text", eventTitle);
    url.searchParams.append("dates", `${start}/${end}`);
    if (locationName) url.searchParams.append("location", locationName);
    url.searchParams.append("details", "Bu etkinlik Lexwoow üzerinden planlandı.");

    window.open(url.toString(), "_blank");
    setClicked(true);
    setTimeout(() => setClicked(false), 3000); 
  };

  return (
    <button 
      onClick={handleAddToCalendar}
      className={cn(
        "group mt-3 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl transition-all border shadow-sm bg-white hover:shadow-md",
        clicked ? "border-green-200 bg-green-50" : "border-slate-200 hover:border-amber-200"
      )}
      title="Google Takvime Ekle"
    >
      {clicked ? (
        <>
            <Check size={18} className="text-green-600" />
            <span className="font-bold text-sm text-green-700">Takvime İşlendi</span>
        </>
      ) : (
        <>
            <CalendarPlus size={18} className="text-slate-400 group-hover:text-amber-500 transition-colors" />
            <div className="flex items-center gap-1.5 font-bold text-sm">
                {/* GOOGLE LOGO RENKLERİ (Mavi-Kırmızı-Sarı-Yeşil) */}
                <span className="flex items-center tracking-tight text-[15px]">
                    <span className="text-[#4285F4]">G</span>
                    <span className="text-[#EA4335]">o</span>
                    <span className="text-[#FBBC05]">o</span>
                    <span className="text-[#4285F4]">g</span>
                    <span className="text-[#34A853]">l</span>
                    <span className="text-[#EA4335]">e</span>
                </span>
                
                {/* "Takvime Ekle" - TURUNCU */}
                <span className="text-amber-600 group-hover:text-amber-700 transition-colors">
                    Takvime Ekle
                </span>
            </div>
        </>
      )}
    </button>
  );
}