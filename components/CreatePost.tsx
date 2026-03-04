"use client";
import { useState, useRef, useEffect } from "react";
import imageCompression from "browser-image-compression";
import { createClient } from "@/utils/supabase/client"; 
import { Calendar, MapPin, Image as ImageIcon, Loader2, X, Clock, Globe, Building2, BarChart2, Plus, Trash2 } from "lucide-react"; 
import { cn } from "@/utils/cn";
import { ALL_LOCATIONS, LocationItem, LocationType } from "@/utils/locations"; 
import toast from "react-hot-toast";

export default function CreatePost({ userId }: { userId: string }) {
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  
  // --- EVENT STATE ---
  const [isEventMode, setIsEventMode] = useState(false);
  const [dateInput, setDateInput] = useState("");
  const [timeInput, setTimeInput] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  
  // --- POLL STATE ---
  const [isPollMode, setIsPollMode] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]); // Start with 2 empty options
  const [pollDuration, setPollDuration] = useState(3); // Default 3 days
  const [isAnonymous, setIsAnonymous] = useState(false);

  // --- LOCATION SEARCH STATE ---
  const [filteredLocations, setFilteredLocations] = useState<LocationItem[]>([]);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const locationWrapperRef = useRef<HTMLDivElement>(null);
  const [isOverflowVisible, setIsOverflowVisible] = useState(false);

  const supabase = createClient();

  // Mode Switching Logic (Mutually Exclusive)
  const toggleEventMode = () => {
    if (isPollMode) setIsPollMode(false);
    setIsEventMode(!isEventMode);
  };

  const togglePollMode = () => {
    if (isEventMode) setIsEventMode(false);
    setIsPollMode(!isPollMode);
    // Reset options if opening
    if (!isPollMode) setPollOptions(["", ""]); 
  };

  // Animation Overflow Control
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (isEventMode || isPollMode) {
      timeout = setTimeout(() => setIsOverflowVisible(true), 300);
    } else {
      setIsOverflowVisible(false);
    }
    return () => clearTimeout(timeout);
  }, [isEventMode, isPollMode]);

  // Click Outside Listener
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (locationWrapperRef.current && !locationWrapperRef.current.contains(event.target as Node)) {
        setShowLocationDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // --- EVENT HANDLERS ---
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val) {
      const year = parseInt(val.split("-")[0]);
      if (year > 2034) {
        toast.error("Etkinlik tarihi 2034 yılından sonrasına ayarlanamaz.");
        setDateInput("");
        return;
      }
    }
    setDateInput(val);
  };

  const handleLocationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const userInput = e.target.value;
    setEventLocation(userInput);

    if (userInput.length > 0) {
      const filtered = ALL_LOCATIONS.filter(item => 
        item.name.toLocaleLowerCase('tr').includes(userInput.toLocaleLowerCase('tr'))
      );
      setFilteredLocations(filtered.slice(0, 20));
      setShowLocationDropdown(true);
    } else {
      setShowLocationDropdown(false);
    }
  };

  const selectLocation = (locName: string) => {
    setEventLocation(locName);
    setShowLocationDropdown(false);
  };

  // --- POLL HANDLERS ---
  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...pollOptions];
    newOptions[index] = value;
    setPollOptions(newOptions);
  };

  const addPollOption = () => {
    if (pollOptions.length >= 4) return;
    setPollOptions([...pollOptions, ""]);
  };

  const removePollOption = (index: number) => {
    if (pollOptions.length <= 2) return;
    const newOptions = pollOptions.filter((_, i) => i !== index);
    setPollOptions(newOptions);
  };

  const getLocationIcon = (type: LocationType) => {
    switch (type) {
        case 'country': return <Globe size={16} className="text-blue-500" />;
        case 'venue': return <Building2 size={16} className="text-orange-500" />;
        case 'district': return <MapPin size={16} className="text-purple-500" />;
        case 'city': return <MapPin size={16} className="text-emerald-500" />;
        default: return <MapPin size={16} className="text-gray-400" />;
    }
  };

  // --- SUBMIT LOGIC ---
  const handleUpload = async () => {
    if (!content.trim()) return toast.error(isPollMode ? "Anket sorusu boş olamaz!" : "Hukuki bir şeyler yazmalısın!");
    
    setLoading(true);

    try {
      // --- SCENARIO A: CREATE POLL ---
      if (isPollMode) {
        // 1. Validate Options
        const validOptions = pollOptions.filter(o => o.trim().length > 0);
        if (validOptions.length < 2) {
            throw new Error("En az 2 anket seçeneği girmelisiniz.");
        }

        // 2. Calculate Expiry
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + pollDuration);

        // 3. Insert Poll
        const { data: pollData, error: pollError } = await supabase
            .from('polls')
            .insert({
                creator_id: userId,
                question: content,
                is_anonymous: isAnonymous,
                expires_at: expiresAt.toISOString(),
            })
            .select()
            .single();

        if (pollError) throw pollError;

        // 4. Insert Options
        const optionsPayload = validOptions.map((text, index) => ({
            poll_id: pollData.id,
            option_text: text,
            display_order: index
        }));

        const { error: optionsError } = await supabase
            .from('poll_options')
            .insert(optionsPayload);

        if (optionsError) throw optionsError;

        // 5. Success
        toast.success("Anket oluşturuldu!");
        setIsPollMode(false);
        setPollOptions(["", ""]);
        setContent("");
        
        // Notify Parent/Feed (Feed needs to listen for 'new-poll-created')
        const newPollEvent = new CustomEvent('new-poll-created', { detail: pollData });
        window.dispatchEvent(newPollEvent);
      } 
      
      // --- SCENARIO B: CREATE STANDARD POST / EVENT ---
      else {
        let imageUrl = null;
        if (file) {
          const options = { maxSizeMB: 0.2, maxWidthOrHeight: 1080, useWebWorker: true };
          const compressedFile = await imageCompression(file, options);
          const fileName = `${userId}/${Date.now()}.webp`;
          
          const { error: uploadError } = await supabase.storage
            .from("post-attachments")
            .upload(fileName, compressedFile);

          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage
            .from("post-attachments")
            .getPublicUrl(fileName);
          
          imageUrl = urlData.publicUrl;
        }

        let finalEventDate = null;
        if (isEventMode && dateInput) {
          const timePart = timeInput || "00:00";
          finalEventDate = new Date(`${dateInput}T${timePart}`).toISOString();
        }

        const payload: any = {
          user_id: userId,
          content: content,
          image_url: imageUrl,
          category: "teori",
          is_event: isEventMode,
          event_date: finalEventDate,
          event_location: (isEventMode && eventLocation) ? { name: eventLocation } : null,
          event_status: isEventMode ? 'upcoming' : null
        };

        const { data, error: dbError } = await supabase
          .from("posts")
          .insert(payload)
          .select(`
            *, 
            profiles (
              full_name, 
              avatar_url, 
              username, 
              reputation
            )
          `) 
          .single();

        if (dbError) throw dbError;

        const newPostEvent = new CustomEvent('new-post-created', { detail: data });
        window.dispatchEvent(newPostEvent);

        // Reset
        setContent("");
        setFile(null);
        if (isEventMode) {
           setIsEventMode(false);
           setDateInput("");
           setTimeInput("");
           setEventLocation("");
        }
      }

    } catch (error: any) {
      console.error("Hata:", error);
      toast.error(error.message || "Bir şeyler ters gitti.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300">
      
      {/* İÇERİK ALANI */}
      <div className="relative group">
        <textarea
          className="w-full bg-transparent text-gray-800 placeholder:text-gray-400 p-2 text-lg outline-none resize-none min-h-[90px] font-medium leading-relaxed"
          placeholder={
              isEventMode ? "Etkinlik detaylarını, gündemi ve amacı buraya gir..." : 
              isPollMode ? "Takipçilerine sormak istediğin soruyu buraya yaz..." :
              "Hukuki bir analiz paylaş veya topluluğa danış..."
          }
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="absolute bottom-0 left-2 right-2 h-[1px] bg-gray-100 group-focus-within:bg-blue-500/50 transition-colors" />
      </div>

      {/* --- EVENT SECTION --- */}
      <div className={cn(
        "grid transition-all duration-300 ease-in-out gap-3 px-1",
        isEventMode ? "grid-rows-[1fr] opacity-100 py-4" : "grid-rows-[0fr] opacity-0",
        isOverflowVisible && isEventMode ? "overflow-visible" : "overflow-hidden"
      )}>
        <div className="min-h-0 flex flex-col gap-3">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl flex items-center px-3 py-2.5 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                  <Calendar size={18} className="text-gray-400 mr-2 shrink-0" />
                  <input 
                      type="date"
                      max="2034-12-31" 
                      className="bg-transparent border-none text-sm text-gray-700 w-full outline-none font-medium uppercase"
                      value={dateInput}
                      onChange={handleDateChange}
                  />
              </div>
              <div className="w-full md:w-1/3 bg-gray-50 border border-gray-200 rounded-xl flex items-center px-3 py-2.5 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                  <Clock size={18} className="text-gray-400 mr-2 shrink-0" />
                  <input 
                      type="time"
                      className="bg-transparent border-none text-sm text-gray-700 w-full outline-none font-medium"
                      value={timeInput}
                      onChange={(e) => setTimeInput(e.target.value)}
                  />
              </div>
            </div>

            {/* KONUM DROPDOWN */}
            <div 
                ref={locationWrapperRef}
                className="group relative bg-gray-50 border border-gray-200 rounded-xl flex flex-col justify-center px-3 py-2.5 focus-within:ring-2 focus-within:ring-blue-100 transition-all"
            >
                <div className="flex items-center w-full">
                    <MapPin size={18} className="text-gray-400 mr-3 group-focus-within:text-blue-500 shrink-0 transition-colors" />
                    <input 
                        type="text"
                        placeholder="Konum, İlçe veya Adliye Ara..."
                        className="bg-transparent border-none text-sm text-gray-700 w-full outline-none placeholder:text-gray-400 font-medium"
                        value={eventLocation}
                        onChange={handleLocationChange}
                        onFocus={() => eventLocation.length > 0 && setShowLocationDropdown(true)}
                        autoComplete="off"
                    />
                    {eventLocation && (
                        <button onClick={() => {setEventLocation(""); setShowLocationDropdown(false)}} className="text-gray-400 hover:text-red-500 ml-2">
                           <X size={14} />
                        </button>
                    )}
                </div>

                {showLocationDropdown && (
                    <div className="absolute top-[115%] left-0 w-full max-h-[220px] overflow-y-auto bg-white border border-gray-100 rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.2)] z-[9999]">
                        {filteredLocations.map((loc, index) => (
                            <div 
                                key={index}
                                onClick={() => selectLocation(loc.name)}
                                className="px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-none transition-colors flex items-center gap-3"
                            >
                                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                                    {getLocationIcon(loc.type)}
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium text-gray-800">{loc.name}</span>
                                    {loc.detail && <span className="text-[10px] text-gray-400">{loc.detail}</span>}
                                </div>
                            </div>
                        ))}
                        {filteredLocations.length === 0 && eventLocation && (
                             <div 
                                onClick={() => selectLocation(eventLocation)}
                                className="px-4 py-3 text-sm text-gray-700 hover:bg-blue-50 cursor-pointer transition-colors flex items-center gap-3"
                             >
                                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                                    <MapPin size={16} className="text-gray-400" />
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-medium text-gray-800">"{eventLocation}"</span>
                                    <span className="text-[10px] text-gray-400">Özel Konum Olarak Kullan</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
      </div>

      {/* --- POLL SECTION --- */}
      <div className={cn(
        "grid transition-all duration-300 ease-in-out gap-3 px-1",
        isPollMode ? "grid-rows-[1fr] opacity-100 py-4" : "grid-rows-[0fr] opacity-0",
        isOverflowVisible && isPollMode ? "overflow-visible" : "overflow-hidden"
      )}>
        <div className="min-h-0 flex flex-col gap-3">
             {pollOptions.map((option, index) => (
                 <div key={index} className="flex items-center gap-2">
                     <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl flex items-center px-3 py-2.5 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
                        <span className="text-xs text-gray-400 mr-2 font-mono">{index + 1}.</span>
                        <input 
                            type="text"
                            placeholder={`Seçenek ${index + 1}`}
                            className="bg-transparent border-none text-sm text-gray-700 w-full outline-none font-medium"
                            value={option}
                            onChange={(e) => handleOptionChange(index, e.target.value)}
                        />
                     </div>
                     {pollOptions.length > 2 && (
                         <button onClick={() => removePollOption(index)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors">
                             <Trash2 size={16} />
                         </button>
                     )}
                 </div>
             ))}
             
             {pollOptions.length < 4 && (
                 <button 
                    onClick={addPollOption}
                    className="flex items-center justify-center gap-2 text-sm text-blue-600 font-medium py-2 hover:bg-blue-50 rounded-lg transition-colors border border-dashed border-blue-200"
                 >
                     <Plus size={16} />
                     Seçenek Ekle
                 </button>
             )}

             <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 font-medium">Süre:</span>
                    <select 
                        value={pollDuration} 
                        onChange={(e) => setPollDuration(Number(e.target.value))}
                        className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-1.5 outline-none focus:border-blue-300"
                    >
                        <option value={1}>24 Saat</option>
                        <option value={3}>3 Gün</option>
                        <option value={7}>1 Hafta</option>
                    </select>
                </div>
                <label className="flex items-center gap-2 cursor-pointer group">
                    <input 
                        type="checkbox" 
                        checked={isAnonymous}
                        onChange={(e) => setIsAnonymous(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-500 group-hover:text-gray-700">Anonim Oylama</span>
                </label>
             </div>
        </div>
      </div>
      
      {/* BUTONLAR */}
      <div className="flex items-center justify-between pt-3 mt-1">
        <div className="flex items-center gap-1">
            {/* Image Upload (Disabled in Poll Mode) */}
            <label className={cn(
                "p-2.5 rounded-full cursor-pointer transition-all flex items-center justify-center border border-transparent",
                isPollMode ? "opacity-30 cursor-not-allowed" : "hover:bg-gray-100 hover:text-gray-600",
                file ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "text-gray-400"
            )} title="Görsel Ekle">
                <input
                type="file"
                accept="image/*"
                disabled={isPollMode}
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
                <ImageIcon size={20} strokeWidth={1.5} />
            </label>

            {/* Event Toggle */}
            <button 
                onClick={toggleEventMode}
                className={cn(
                "p-2.5 rounded-full transition-all flex items-center justify-center border border-transparent",
                isEventMode 
                    ? "bg-blue-50 text-blue-600 border-blue-100" 
                    : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                )}
                title={isEventMode ? "Etkinlik Modunu Kapat" : "Etkinlik Oluştur"}
            >
                {isEventMode ? <X size={20} strokeWidth={1.5} /> : <Calendar size={20} strokeWidth={1.5} />}
            </button>

            {/* Poll Toggle (New) */}
            <button 
                onClick={togglePollMode}
                className={cn(
                "p-2.5 rounded-full transition-all flex items-center justify-center border border-transparent",
                isPollMode
                    ? "bg-purple-50 text-purple-600 border-purple-100" 
                    : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                )}
                title={isPollMode ? "Anket Modunu Kapat" : "Anket Oluştur"}
            >
                {isPollMode ? <X size={20} strokeWidth={1.5} /> : <BarChart2 size={20} strokeWidth={1.5} />}
            </button>
        </div>
        
        <button
          onClick={handleUpload}
          disabled={loading || !content.trim()}
          className={cn(
            "px-6 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 flex items-center gap-2 transform active:scale-95",
            isEventMode 
                ? "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-500/30" 
            : isPollMode
                ? "bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-lg shadow-purple-500/30"
                : "bg-gray-900 hover:bg-black text-white shadow-lg shadow-gray-200/50",
            (loading || !content.trim()) && "opacity-50 cursor-not-allowed shadow-none grayscale"
          )}
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {isEventMode ? "Bileti Oluştur" : isPollMode ? "Anketi Başlat" : "Paylaş"}
        </button>
      </div>

      {file && !isPollMode && (
        <div className="mt-3 px-3 py-1.5 bg-emerald-50 rounded-lg border border-emerald-100 text-[11px] font-semibold text-emerald-600 inline-flex items-center gap-2 animate-in slide-in-from-bottom-2 fade-in">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {file.name}
        </div>
      )}
    </div>
  );
}