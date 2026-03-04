# Audit ve Loglama Politikasi

Belge: Hukuk Asistani Belge Editoru - Audit/Log Policy  
Surum: v1  
Yururluk Tarihi: 2026-02-22

## 1. Politika Amaci
Sistem uzerindeki tum kritik islemleri sonradan inkar edilemez sekilde kayda almak, olay incelemeyi hizlandirmak ve KVKK uyumunu saglamak.

## 2. Olay Siniflari
1. Kimlik ve erisim:
   - login_success, login_failed, token_refresh, role_change
2. Belge islemleri:
   - document_create, document_edit, document_status_change, document_export
3. Final butunluk:
   - final_lock, hash_generated, hash_verified
4. Paylasim:
   - share_link_create, share_link_view, share_link_comment, share_link_revoke, share_link_expire
5. Guvenlik:
   - permission_denied, suspicious_access, pii_detected, incident_opened, incident_closed
6. Sistem:
   - backup_started, backup_completed, restore_started, restore_completed

## 3. Zorunlu Audit Alanlari
- `event_id` (UUID)
- `event_type`
- `occurred_at` (UTC ISO-8601)
- `actor_type` (user/system/service)
- `actor_id`
- `tenant_id`
- `object_type` (document/share_link/export/session)
- `object_id`
- `ip_address`
- `user_agent_hash`
- `request_id`
- `result` (success/denied/error)
- `reason_code` (opsiyonel ama guvenlik olayinda zorunlu)
- `data_classification` (genel/hassas/ozel_nitelikli/final)

## 4. KVKK Uyum Kurallari
1. Ham PII uygulama loguna yazilmaz; `redact_for_log` zorunlu.
2. Audit kaydi iceriginde belge metni tutulmaz; yalnizca metadata ve hash tutulur.
3. Ozel nitelikli veri olaylari yuksek oncelikli incident sinifina otomatik aday olur.
4. Audit verisine erisim sadece `SecurityAdmin` ve yetkili denetim rolu ile mumkundur.

## 5. Saklama Sureleri (MVP)

| Kayit Turu | Min Saklama | Max Saklama | Not |
|---|---|---|---|
| Guvenlik/audit loglari | 2 yil | 10 yil | Legal hold varsa imha edilmez |
| Uygulama hata loglari | 180 gun | 2 yil | PII maskeli |
| Paylasim erisim loglari | 2 yil | 10 yil | Delil butunlugu icin |
| Backup/restore operasyon loglari | 2 yil | 10 yil | Olay inceleme girdisi |

## 6. Degistirilemezlik ve Butunluk
- Audit tablosu append-only calisir.
- Silme/isleme sadece retention motoru ile, yetkili imha kaydi ureterek yapilir.
- Her final belge olayi hash kaydi ile audit zincirine baglanir.

## 7. Izleme ve Alarm
- Gercek zamanli alarmlar:
  - art arda failed login
  - kisa surede anomali indirme
  - final belgeye yetkisiz erisim denemesi
- Seviyeler:
  - Sev-1: veri sizintisi supesi
  - Sev-2: yetkisiz erisim ama sizinti teyitsiz
  - Sev-3: operasyonel hata

## 8. Raporlama
- Haftalik: anomali ozet raporu
- Aylik: erisim yetki gozden gecirme raporu
- Ceyreklik: audit butunluk denetimi + rastgele hash dogrulamasi
