# Retention ve Backup Politikasi

Belge: Hukuk Asistani Belge Editoru - Retention/Backup Policy  
Surum: v1  
Yururluk Tarihi: 2026-02-22

## 1. Politika Amaci
Belge ve log verilerinin yasal/operasyonel gereksinimlere uygun saklanmasi, geri donulebilirligi ve kontrollu imhasi.

## 2. Retention Kurallari

| Veri Turu | Durum | Varsayilan Saklama | Legal Hold Durumu | Imha Yontemi |
|---|---|---|---|---|
| Draft belge icerigi | Draft/Review | 3 yil | Hold varsa saklanir | Guvenli silme + imha kaydi |
| Final belge icerigi | Final/Archived | 10 yil | Hold varsa suresiz bekletilir | Yasal onay sonrasi guvenli silme |
| Export dosyalari (PDF/DOCX) | Tum | 3 yil | Hold varsa saklanir | Object lifecycle delete |
| Audit ve guvenlik loglari | Tum | Min 2 yil, max 10 yil | Hold varsa saklanir | WORM policy sonu imha |
| Gecici dosyalar/cache | Gecici | 30 gun | Hold uygulanmaz | Otomatik cleanup |

## 3. Imha (Deletion) Is Akisi
1. Retention motoru aday kayitlari isaretler.
2. Legal hold kontrolu yapilir (`legal_hold=true` ise islem durur).
3. Uygun kayitlar icin imha islemi tetiklenir.
4. Imha olayina zorunlu audit kaydi dusulur:
   - `deletion_batch_id`
   - `approved_by`
   - `executed_at`
   - `object_count`

## 4. Backup Stratejisi
- Veritabani:
  - Gunluk full backup
  - Saatlik incremental/WAL arsivi
- Object storage:
  - Bucket versioning aktif
  - Non-current object retention aktif
- Sifreleme:
  - Backup dosyalari at-rest encrypted
  - Anahtar rotasyonu 12 ay

## 5. RPO/RTO Hedefleri (MVP)
- RPO (maks veri kaybi): <= 1 saat
- RTO (servisi geri acma): <= 8 saat
- Kritik final belge retrieval hedefi: <= 2 saat

## 6. Restore Proseduru
1. Incident commander restore kararini verir.
2. Etkilenen tenant/obje kapsami netlenir.
3. Izole ortamda dry-run restore yapilir.
4. Hash dogrulamasi:
   - Final belgelerde `content_hash_sha256` eslesmesi zorunlu
5. Uretim ortamina kontrollu geri yukleme yapilir.
6. Restore tamamlaninca olay raporu ve audit kaydi kapanir.

## 7. Test ve Tatbikat
- Aylik: rastgele tenant icin restore tatbikati
- Ceyreklik: tam sistem felaket kurtarma tatbikati
- Test basarisiz ise 10 is gunu icinde duzeltici aksiyon plani zorunlu
