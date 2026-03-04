# Kurumsal Guvenlik ve Operasyon Politikasi

Belge: Hukuk Asistani Belge Editoru - Security Operations Policy  
Surum: v1  
Yururluk Tarihi: 2026-02-22

## 1. Erisim Modeli (RBAC + Object-Level Permission)

### 1.1 Roller
- `Owner`: Tam yetki, final onay, arsiv/imha onayi
- `Editor`: Draft/Review duzenleme, export
- `Reviewer`: Yorum, review onayi/geri cevirme
- `Commenter`: Yorum
- `Viewer`: Sadece okuma
- `SecurityAdmin`: Audit ve guvenlik olay yonetimi

### 1.2 Object-Level Kurallar
1. Yetki kontrolu `tenant_id + document_id + role` uzerinden yapilir.
2. `Final` belgede yalniz `Owner` yeni surum baslatabilir.
3. Tenant disi erisim her zaman deny + audit.
4. En az ayricalik ilkesi varsayilan politikadir.

## 2. Paylasim Linki Politikasi
- Varsayilan link omru: 24 saat
- Maksimum link omru: 7 gun
- Tekil hassas belge paylasiminda omur: 60 dakika
- Link kapsam tipleri:
  - `view_only`
  - `comment_only`
- Link kisitlari:
  - IP allowlist (opsiyonel)
  - tek kullanim modu (opsiyonel)
  - manuel revoke zorunlu desteklenir
- Suresi dolan veya revoke edilen link 410/403 ile reddedilir.

## 3. Olay Mudahale Akisi
1. Tespit: alarm veya kullanici bildirimi
2. Siniflandirma: Sev-1 / Sev-2 / Sev-3
3. Kontrol altina alma: erisim kesme, token iptali, link revoke
4. Delil toplama: audit export, hash dogrulama, zaman cizelgesi
5. Iyilestirme: yama, konfigurasyon duzeltme, yetki daraltma
6. Kapanis: postmortem + kok neden analizi + aksiyon takibi

## 4. SLA ve Bildirim Hedefleri
- Sev-1 ilk yanit: <= 15 dakika
- Sev-2 ilk yanit: <= 60 dakika
- Sev-3 ilk yanit: <= 1 is gunu
- Sev-1 olayinda yonetim bilgilendirme: <= 1 saat

## 5. Isletimsel Kontroller
- Aylik erisim yetki gozden gecirme
- Ceyreklik incident tabletop exercise
- Kritiklik degisikliginde acil konfig denetimi
- Ayrilan personel erisimi en gec 4 saat icinde kaldirilir
