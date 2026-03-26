# Calendar Sync QA Checklist

## 1) Task + Timeline Sync (Core)

1. `/dashboard/calendar` sayfasına gidin.
2. `Hizli Event Ekle` bölümünde `Bu kaydi gorev olarak da olustur` kutusunu aktif edin.
3. Baslik + tarih girip kaydedin.
4. Beklenen:
   - Takvim listesinde **tek bir task satiri** gorunur (deadline).
   - Ayni gorev icin manuel deadline reminder duplicate gorunmez.
   - Ayni goreve bagli otomatik pre-reminder satirlari (`Oto Hatirlatma`) gorunur.

## 2) Dedupe Validation

1. Olusan gorevin tarihini not edin.
2. Ayni case icin ayni saatte manuel reminder olusturmaya calisin.
3. Beklenen:
   - Task kaynakli ana deadline satiri duplicate olmaz.
   - Manuel olan timeline event, task ile senkron bagli degilse ayri satir olur.

## 3) Edit Flow (Task)

1. Task kaynakli bir kayitta `Duzenle` butonuna basin.
2. Tarih, oncelik, durum, sorumlu, task tipi alanlarindan birkacini degistirin.
3. Beklenen:
   - Task satiri guncellenir.
   - Bagli otomatik reminder zincirinin saatleri/tarihleri yeniden hizalanir.

## 4) Delete Flow (Task)

1. Task kaynakli bir kayitta `Takvimden Kaldir` aksiyonunu kullanin.
2. Beklenen:
   - Gorevin due date'i temizlenir ve durum `done` olur.
   - Bagli timeline reminder zinciri soft-delete edilir.
   - Satir takvim listesinden kaybolur.

## 5) Edit/Delete Flow (Manual Timeline Event)

1. `createTask` kapali halde manuel bir reminder olusturun.
2. Kaydi `Duzenle` ile degistirin.
3. Ardindan `Sil` ile kaldirin.
4. Beklenen:
   - Guncelleme/silme basarili.
   - Task-sync kaynakli reminder kayitlarinda duzenleme/silme engelli kalir.

## 6) Filters

1. Filtrelerden sirayla deneyin:
   - Sorumlu
   - Gorev tipi
   - Sure tipi
   - Risk
   - Gizlilik
2. Beklenen:
   - Liste ve haftalik gorunumde filtre sonucu tutarli.
   - `Sorumlu Is Yuku` kartlari secili araliga gore dogru sayi verir.

## 7) Weekly View + Google Calendar

1. `Haftalik` gorunume gecin.
2. Bir kayitta `Google` linkine tiklayin.
3. Beklenen:
   - Google Calendar yeni pencere linki dogru acilir.
   - Baslik ve tarih/saat tasinir.

## 8) Role and Access

1. Lawyer kullanicisi ile sadece kendi case'lerini goruntuleme kontrolu.
2. Assistant kullanicisi ile ofis kapsaminda goruntuleme kontrolu.
3. Beklenen:
   - Yetki disi case icin 403.

## 9) Regression

1. `/dashboard/cases` icinden task olusturun.
2. `/dashboard/calendar` a donun.
3. Beklenen:
   - Yeni task calendar'da gorunur.
   - Reminder zinciri otomatik uretilmis olur.

## 10) Bulk Task Regression

1. Toplu task olusturma akisini calistirin.
2. Calendar sayfasinda ilgili case'lerde kontrol edin.
3. Beklenen:
   - Her task icin sync reminder zinciri olusur.
   - User action timeline izi gorunur.

## 11) View Modes (Day / Week / Month / List)

1. Takvim ustunden sirayla `Gun`, `Haftalik`, `Aylik`, `Liste` secin.
2. Beklenen:
   - Tum gorunumler veri cekip bos kalmadan render olur.
   - `Bugun`, `Onceki`, `Sonraki` butonlari secili gorunume gore donemi kaydirir.
   - `Liste` modunda `Baslangic/Bitis` alanlari aktif kalir.

## 12) Search + New Filters (`q`, `status`, `eventType`)

1. Arama kutusuna bir baslik parcasi yazin.
2. `Durum` filtresinden `Planlandi`, `Hazirlandi`, `Tamamlandi`, `Ertelendi` seceneklerini sirayla deneyin.
3. `Event Turu` filtresinden `Durusma`, `Tebligat`, `Teslim`, `Son Gun`, `Hatirlatma` seceneklerini deneyin.
4. Beklenen:
   - Sonuclar tum gorunumlerde tutarli filtrelenir.
   - Ustteki sayaclar (`Toplam/Gecmis/Bugun/Yaklasan`) filtreli sonuca gore degisir.
   - `Filtreleri Temizle` tum yeni filtreleri de sifirlar.

## 13) Workflow Status Badge

1. Farkli kaynaklardan kayit olusturun:
   - Task deadline (open/in_progress/done)
   - Manual timeline reminder
2. Beklenen:
   - Kartlarda `workflowStatus` badge gorunur.
   - Task `open -> Planlandi`, `in_progress -> Hazirlandi`, `done -> Tamamlandi` eslesmesi dogru calisir.
   - Gecmis manual reminder kayitlari uygun oldugunda `Ertelendi` olarak etiketlenir.

## 14) Conflict Warning (Create Task)

1. Ayni sorumluya, birbirine 60 dk icinde iki ayri task takvim kaydi olusturun (`createTask` acik).
2. Beklenen:
   - Kayit engellenmez (non-blocking davranis).
   - Basarili kayit mesajina cakisma uyarisi eklenir.
   - Uyarida cakisan kayit sayisi ve ornek kayit saatleri gorunur.

## 15) Conflict Warning (Update Task / Reminder)

1. Var olan task deadline kaydini duzenleyip ayni sorumlu icin cakisacak saate cekin.
2. Beklenen:
   - Guncelleme tamamlanir.
   - Ust mesajda conflict warning doner.
   - Reminder zinciri (task_pre_reminder + task_deadline) yeni tarihe gore hizalanir.

## 16) Month Grid Coverage

1. `Aylik` gorunume gecin.
2. Ayin ilk haftasi ve son haftasindaki dis gun hucrelerinde kayit varsa kontrol edin.
3. Beklenen:
   - 7x6 grid dolu render olur.
   - Onceki/sonraki aydan gelen gunlerdeki kayitlar da gorunur.
