# Hukuk Asistani Belge Editoru - Product Scope v1

## 1. Amac ve Problem Tanimi
Hukuk ekipleri belge uretiminde hiz, tutarlilik ve cikti kalitesi sorunu yasiyor. MVP'nin amaci; dava/sozlesme odakli belge hazirlama surecini hizlandiran, guvenli paylasim ve kayit izi saglayan bir editor sunmaktir.

Bu surum "tam bir Word alternatifi" degil; hukuk odakli, guvenli ve pratik bir belge is akisi urunudur.

## 2. MVP Kapsam Kararlari (Var / Yok)

### 2.1 MVP'de Var
- Guclu zengin metin duzenleme (basliklar, listeler, tablo, hizalama, temel stiller)
- A4 gorunum simulasyonu
- Sablonlar + dinamik alanlar
- Clause/snippet library (minimal: sik kullanilan hukuki paragraflar)
- Autosave + crash recovery
- Versiyon snapshot
- PDF export (server-side, deterministik cikti)
- DOCX export (best-effort)
- Guvenli paylasim (view/comment)
- Audit log (kim-ne-zaman)

### 2.2 MVP'de Yok (Ertelenecek)
- Gercek zamanli ortak duzenleme
- Tam track changes/redline
- Tam footnote/TOC/cross-reference
- PDF -> tam duzenlenebilir donusum
- UDF uretimi

## 3. Hedef Kullanici Segmenti Karari

### 3.1 Birincil Segment (MVP odak)
- Bireysel avukat
- Kucuk/orta buro (2-50 kisi)

Neden: daha hizli onboarding, daha kisa satin alma dongusu, ihtiyaclarin daha homojen olmasi.

### 3.2 Ikincil Segment (MVP sonrasina ertelenir)
- Kurumsal hukuk ekibi

Neden: ileri entegrasyon, kompleks yetkilendirme ve procurement gereksinimleri MVP kapsam disi.

## 4. Belge Turu Onceligi
1. Dilekce
2. Sozlesme
3. Ihtarname
4. Savunma
5. Ic yazisma

Not: Ilk 3 belge turu MVP'nin "kullanim ispati" icin zorunlu kabul edilir.

## 5. UDF ve UYAP Beklenti Yonetimi Karari
- MVP'de UDF export yok.
- Cikti stratejisi:
1. PDF (ana cikti)
2. DOCX (best-effort)
3. UYAP'a yukleme/formatlama icin yonlendirilmis donusum akisi (kullanici rehberi + kontrol listesi)

Net ifade: "MVP, UYAP'a dogrudan UDF ureten bir urun degildir."

## 6. Guvenlik ve Hukuki Cerceve (MVP Minimumu)
- Rol bazli erisim (owner/editor/commenter/viewer)
- Tum paylasim aksiyonlari audit log'a yazilir
- Belge versiyonlari degistirilemez kayit olarak saklanir (snapshot)
- Yetkisiz erisim denemeleri kayitlanir
- Gizlilik notu: MVP, hukuk tavsiyesi vermez; belge hazirlama aracidir

## 7. MVP Basari Kriterleri (Olculebilir)

### 7.1 Performans ve Stabilite
- 50 sayfalik belgede kesintisiz duzenleme:
  - yazma gecikmesi p95 <= 120 ms
  - editorde kritik hata ile veri kaybi orani < %1 seans
- Autosave:
  - en gec 10 saniyede bir kalici kayit
  - beklenmedik kapanmada son kayip <= 10 saniye

### 7.2 Cikti Kalitesi
- PDF export basari orani >= %99 (MVP desteklenen icerik setinde)
- PDF cikti "mahkemeye sunulabilir" kalite esigi:
  - sayfa duzeni korunur
  - Turkce karakter bozulmasi olmaz
  - baslik/paragraf hiyerarsisi okunur kalir
- DOCX export basari orani >= %95 (best-effort kabul kriteri)

### 7.3 Urun Degeri
- Ilk 30 gun icinde aktif kullanicilarin >= %60'i en az 1 belgeyi sifirdan olusturup export eder
- Ilk 30 gun icinde olusturulan belgelerin >= %40'i sablon/dinamik alan kullanir
- Guvenli paylasim ozelligi kullanim orani >= %25 (aktif ekiplerde)

## 8. MVP Disi Talepler Icin Karar Kapisi
Asagidaki talepler ancak MVP basari kriterleri saglandiktan sonra roadmap'e alinacaktir:
1. Gercek zamanli ortak duzenleme
2. Tam redline/track changes
3. Gelismis referans sistemleri (TOC/footnote/cross-reference)
4. UDF uretimi ve dogrudan UYAP entegrasyonu

## 9. Kapsam Disi Islerin Ticari Iletisimi (Tek Cumle)
"Bu urunun MVP surumu; hukuk ekiplerine hizli, guvenli ve kaliteli PDF/DOCX belge uretimi saglar; UDF ve tam ortak duzenleme bu fazda yoktur."
