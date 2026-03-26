# Calendar Ops PRD (Mevcut Sistem Entegrasyonu)

## Amaç
Bu sayfa klasik takvim değil, dosya/süre/duruşma/görev yönetimini tek panelde birleştiren operasyon merkezi olmalıdır.

## Mevcut Sistemde Zaten Olanlar
1. Takvim sayfası aktif: `/dashboard/calendar`.
2. Liste + haftalık görünüm mevcut.
3. Takvim verisi birleşik geliyor: `office_tasks`, `case_timeline_events(reminder)`, `limitation_acceptances`.
4. Hızlı event ekleme var.
5. Takvimden task üretme ve task <-> timeline senkronu var.
6. Task deadline + pre-reminder (`T-7`, `T-3`, `T-1`) otomatik üretiliyor.
7. Task/timeline dedupe var.
8. Gelişmiş filtreler var: sorumlu, task tipi, süre tipi, risk, gizlilik.
9. Satır bazlı düzenle/sil mevcut (senkron kayıt kuralları ile).
10. Google Calendar linki ekli.

## Mevcut Veri Modeli Eşlemesi
1. `matter_id` karşılığı: `case_id` (sistemde dosya = case).
2. `client_id`: case üzerinden `case_clients` ile türetilebilir.
3. `responsible_user_id`: `office_tasks.assigned_to`.
4. `event_type` katmanı:
- Task kaynaklı son gün: `office_tasks.due_at`
- Manual event: `case_timeline_events(event_type='reminder')`
- Süre kabul: `limitation_acceptances.estimated_date`

## Hedef Wireframe'i Mevcut Yapıya Entegrasyon

### Üst Bar
1. Bugün/geri/ileri (mevcut haftalık navigasyon genişletilecek).
2. Görünüm sekmeleri: Gün/Hafta/Ay/Liste.
3. Arama kutusu (`q`) ve hızlı filtre çipleri.
4. `+ Yeni Kayıt` ve `AI ile oluştur` butonu.

### Sol Panel
1. Mini calendar.
2. Event tür legend.
3. Avukat/ekip checkbox filtreleri.
4. Hızlı kayıt butonları: Duruşma, Deadline, Toplantı, Görev.

### Ana Alan
1. Gün/hafta/ay grid.
2. Saat slotları.
3. Çakışma işaretleri.
4. Duruşma/deadline/görev kartları.

### Sağ Panel
1. Bugün listesi.
2. Kritik süreler (1/3/7 gün).
3. Hazırlık eksikleri (task yok, atama yok, checklist eksik).
4. AI uyarıları.
5. Hızlı aksiyonlar.

## P0-P1-P2 Entegrasyon Planı

## P0 (2 sprint)
1. Görünümler: Gün/Hafta/Ay/Liste.
2. Üst bar + arama + hızlı filtre.
3. Event create/edit/delete akışı tek modal/drawer.
4. Çakışma kontrolü (aynı sorumlu + zaman aralığı).
5. Durum alanı (`planned`, `prepared`, `completed`, `postponed`) takvim satırlarına eklenmesi.
6. Role görünürlük genişletmesi (admin/partner/stajyer) için RBAC migration taslağı.

## P1 (2-3 sprint)
1. Duruşma hazırlık checklist modeli.
2. Event-detail drawer içinde belgeler + checklist + aktivite geçmişi.
3. Kritik süre panelini deadline-type bazlı güçlendirme.
4. Sekreterya ekip planlama görünümü.

## P2
1. Google/Outlook iki yönlü sync.
2. Mobil push.
3. Belgeden tarih çıkarımı + otomatik event önerisi.
4. UYAP/e-tebligat adaptör katmanı.

## Gerekli Teknik Değişiklikler

### API (genişletme)
`/api/dashboard/calendar`
1. `GET` query ekleri:
- `view=day|week|month|list`
- `q`
- `status`
- `eventType`
- `teamId` (opsiyonel)
2. `POST/PATCH` body ekleri:
- `startAt`, `endAt`, `allDay`
- `locationName`, `onlineMeetingLink`
- `status`
- `checklistItems`

### DB/Migration (öneri)
1. `case_timeline_events.metadata` standardizasyonu:
- `calendar.startAt`
- `calendar.endAt`
- `calendar.allDay`
- `calendar.locationName`
- `calendar.status`
2. `office_tasks.metadata.calendar` altında uyum anahtarları.
3. Çakışma sorgularını hızlandırmak için index:
- `office_tasks(case_id, assigned_to, due_at)`
- `case_timeline_events(case_id, event_type, deleted_at, created_at)`

## Çakışma Algoritması (MVP)
1. Aynı `assigned_to` için aynı zaman diliminde ikinci kayıt oluşturulursa uyarı.
2. Aynı case içinde aynı saat aralığında birden fazla duruşma varsa kritik uyarı.
3. Uyarı bloklayıcı değil, override seçeneği ile devam.

## Rol Modeli Genişletme Notu
Mevcut sistem `lawyer` ve `assistant` ile çalışıyor.
1. `admin/partner/stajyer` için `profiles.role` enum genişletmesi gerekir.
2. `requireInternalOfficeUser` ve RLS policy güncellenmeli.
3. Takvim yetkileri rol bazlı ayrıştırılmalı (silme/güncelleme/atama).

## UI Bileşenleştirme Planı
`components/dashboard/calendar-workspace.tsx` dosyası bölünecek:
1. `CalendarTopBar.tsx`
2. `CalendarLeftPanel.tsx`
3. `CalendarMainGrid.tsx`
4. `CalendarRightPanel.tsx`
5. `CalendarEventDrawer.tsx`

## Sprint 1 İçin Uygulanacak Net Backlog
1. Top bar + görünüm switch (`day/month/list`) ekle.
2. Arama (`q`) ile event başlık/case başlık filtrelemesi.
3. Event status alanını UI + API + metadata standardına ekle.
4. Çakışma kontrol API doğrulaması ekle.
5. Event drawer (single source form) çıkar.

## Kabul Kriterleri (Sprint 1)
1. Kullanıcı gün/hafta/ay/liste arasında state kaybı olmadan geçebilmeli.
2. Arama sonucu tüm kaynaklarda (task/timeline) çalışmalı.
3. Çakışma durumunda kullanıcı net uyarı almalı.
4. Task-timeline senkronu bozulmamalı.
5. Manual event akışı (düzenle/sil) çalışmaya devam etmeli.
