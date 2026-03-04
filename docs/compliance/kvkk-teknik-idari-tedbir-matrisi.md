# KVKK Teknik ve Idari Tedbir Matrisi

Belge: Hukuk Asistani Belge Editoru - KVKK Kontrol Matrisi  
Surum: v1  
Yururluk Tarihi: 2026-02-22  
Kapsam: Web uygulamasi, API, belge depolama, export ve paylasim akisleri

## 1. Veri Siniflandirma (MVP zorunlu)

| Sinif | Tanim | Ornek | Min. Guvenlik Seviyesi | Izinli Islem |
|---|---|---|---|---|
| Genel | Dogrudan kisiyi tanimlamayan genel metin | Hukuki aciklama notu | Temel | Okuma, duzenleme, export |
| Hassas dava verisi | Dava stratejisi, delil zinciri, taraf bilgisi | Dosya notu, dava ozeti | Yuksek | Rol bazli erisim, tam audit |
| Ozel nitelikli kisisel veri icerebilir | Saglik, ceza, biyometrik vb. veri riski | Saglik raporu ozeti | Cok yuksek | Siki erisim, maskeli log, kisitli paylasim |
| Final/imzaya sunulacak belge | Hukuki olarak sunuma hazir cikti | Mahkemeye sunulacak final PDF | Cok yuksek + butunluk | Kilitli icerik, hash, immutable audit |

## 2. KVKK Teknik/Idari Tedbir Matrisi

| Kontrol Alani | Teknik Tedbir | Idari Tedbir | Sorumlu | Kanit | Siklik |
|---|---|---|---|---|---|
| Veri minimizasyonu | PII redaction pipeline, log masking | Veri isleme envanteri ve ihtiyac bazli veri talebi | Guvenlik + Urun | Redaction log kayitlari | Surekli |
| Erisim kontrolu | RBAC + object-level permission | Yetki matris onayi, ayrilan personel deprovision | IT Ops + IK + Guvenlik | Access review raporu | Aylik |
| Sifreleme | TLS 1.2+, at-rest encryption (DB + object storage) | Anahtar yonetimi proseduru | Platform | KMS rotasyon kaydi | 12 ay |
| Log guvenligi | Immutable audit store, append-only model | Log erisim yetkilerinin sinirlandirilmasi | Guvenlik | Audit sorgu izi | Haftalik izleme |
| Veri butunlugu | Final belgede SHA-256 hash + audit_trail_id bagi | Final onay proseduru (iki goz ilkesi) | Urun + Hukuk Ops | Final kaydi ve hash dogrulama | Her final |
| Veri aktarimi | Kisa omurlu imzali URL, kapsamli link policy | Musteri bilgilendirme metni | Platform + CS | Expired link test raporu | Aylik |
| Yedekleme | RPO/RTO hedefli otomatik backup | Backup/restore tatbikati | SRE | Restore test sonucu | Aylik |
| Olay yonetimi | Alarm + SIEM + olay siniflandirma | Olay mudahale runbook ve masa basi tatbikat | SecOps | Incident postmortem | 3 ay |
| Saklama/imha | Retention policy motoru + legal hold | Imha onay sureci ve kayit | Hukuk Ops + Guvenlik | Retention/imha loglari | Gunluk job |
| Tedarikci guvenligi | Servis hesaplari least privilege | Tedarikci sozlesmesel guvenlik maddeleri | Satinalma + Guvenlik | Vendor due diligence kayitlari | 12 ay |

## 3. Uygulama Kurallari (MVP)
1. Ozel nitelikli veri iceren satirlarin ham hali uygulama loglarina yazilmaz.
2. Final durumundaki belge icerigi degistirilemez; yalniz metadata okunabilir.
3. Final belgeye erisim, olaya ozel yetki ve tam audit zorunlulugu ile acilir.
4. Her paylasim olayi (`create_link`, `view`, `comment`, `revoke`) audit'e yazilir.
5. Data subject talebi geldiginde silme islemi legal hold kontrolunden sonra islenir.

## 4. Politika Baglantilari
- Belge durum kurallari: `docs/compliance/belge-durum-modeli.md`
- Audit/log detaylari: `docs/compliance/audit-loglama-politikasi.md`
- Saklama/yedekleme detaylari: `docs/compliance/retention-backup-politikasi.md`
- Kurumsal guvenlik ve operasyon: `docs/compliance/security-operations-policy.md`
