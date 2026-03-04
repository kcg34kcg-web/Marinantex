# Belge Durum Modeli (Draft / Review / Final / Archived)

Belge: Hukuk Asistani Belge Editoru - Durum Modeli  
Surum: v1  
Yururluk Tarihi: 2026-02-22

## 1. Amac
Belgenin yasam dongusu boyunca hukuki butunluk, izlenebilirlik ve operasyonel netlik saglamak.

## 2. Durumlar

| Durum | Tanim | Icerik Duzenleme | Export | Paylasim | Hukuki Nitelik |
|---|---|---|---|---|---|
| Draft | Serbest calisma alani | Acik | Acik | Kisitli (ic ekip) | Taslak, baglayici degil |
| Review | Gozden gecirme asamasi | Acik (yetkili editor) | Acik | View/comment | Onay oncesi taslak |
| Final | Imzaya/sunuma hazir kilitli surum | Kapali | PDF zorunlu, DOCX opsiyonel | Kisitli ve izli | Delil niteligine uygun nihai surum |
| Archived | Isi bitmis, saklamada | Kapali | Sadece goruntuleme/export | Cok kisitli | Arsiv kaydi |

## 3. Veri Yasam Dongusu (MVP)
1. Olusturma: Belge `Draft` olarak baslar.
2. Taslak saklama: Autosave + versiyon snapshot.
3. Final uretim: `Review` onayi sonrasi `Final`.
4. Paylasim: Yetkili roller ve sureli/kapsamli link.
5. Arsivleme: Is kapaninca `Archived`.
6. Imha/Retention: Politika suresi dolunca imha, legal hold varsa bekletme.

## 4. Draft vs Final Hukuki Modeli (Zorunlu)

### 4.1 Draft
- Serbest duzenlenebilir.
- Snapshot alinir ancak "nihai delil" olarak etiketlenmez.
- Icerik degisikligi ayni belge kimligi altinda devam eder.

### 4.2 Final
- Icerik kilitlenir (immutable content).
- Final aninda asagidaki kayit uretilir:
  - `final_version_id`
  - `content_hash_sha256`
  - `finalized_at`
  - `finalized_by`
  - `audit_trail_id`
- Final hash degeri audit kaydiyla bire bir iliskilendirilir.

### 4.3 Final Sonrasi Degisiklik Kurali
- Final belge uzerinde metin degisikligi gerekirse bu "ayni belge" sayilmaz.
- Yeni belge surumu acilir ve yeniden `Draft -> Review -> Final` akisina girer.
- Onceki final surum read-only kalir, silinmez (legal hold yoksa retention sureci sonunda imha edilir).

## 5. Durum Gecis Kurallari

| Gecis | Kosul | Yetkili Rol | Zorunlu Kayit |
|---|---|---|---|
| Draft -> Review | Editor tamamlandi isaretler | Editor/Owner | Snapshot + review request log |
| Review -> Draft | Revizyon istendi | Reviewer/Owner | Gerekce logu |
| Review -> Final | Onay + butunluk kontrolu gecti | Owner/Partner | Hash + audit trail |
| Final -> Archived | Dosya kapandi | Owner/Admin | Arsiv kaydi |
| Archived -> Draft | Sadece yeni versiyon acma | Owner/Admin | New version link kaydi |

## 6. Teknik Uygulama Notu (MVP)
- Veritabani alanlari:
  - `status` enum: `draft|review|final|archived`
  - `final_version_id` nullable
  - `content_hash_sha256` nullable
  - `locked_at`, `locked_by` nullable
- Uygulama kurali:
  - `status=final|archived` iken edit endpointleri 409 dondurur.
  - Final hash dogrulamasi gecmeden `status=final` yazilamaz.
