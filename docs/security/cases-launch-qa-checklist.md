# Cases Launch QA Checklist

Bu liste `cases` modülünü lansman öncesi hızlı ve güvenli şekilde doğrulamak içindir.

## 1. Otomatik kapı (zorunlu)

1. `npm run regression:cases:launch`
2. Beklenen:
   - `smoke:security:cases` PASS
   - `typecheck:web` PASS

Başarısız olursa lansman durdurulur.

## 2. Rol/yetki sınırı (manuel)

1. `assistant` kullanıcı ile kendi bürosu dışındaki bir `caseId` için:
   - `GET /api/dashboard/cases/detail?caseId=...` -> `403`
   - `GET /api/dashboard/cases/timeline?caseId=...` -> `403`
   - `POST /api/dashboard/cases/clients` -> `403`
2. `assistant` kullanıcı ile timeline silme:
   - `DELETE /api/dashboard/cases/timeline` -> `403` (avukat rolü şartı)
3. `lawyer` kullanıcı ile kendi dosyasında aynı işlemler -> başarılı (200/201)

## 3. Dosya oluşturma akışı (manuel)

1. Yeni dosya oluştur.
2. Opsiyonel ilk görev açıkken oluşturmayı dene:
   - görev başarısızsa ana mesaj: "dosya oluştu ama ilk görev açılamadı" benzeri uyarı olmalı
   - ana mesaj "dosya oluşturulamadı"ya düşmemeli
3. Liste yenileme hatası simüle edilirse:
   - başarı mesajı tamamen kaybolmamalı, sadece "liste yenilenemedi" eki gelmeli

## 4. Belge yükleme güvenliği (manuel)

1. `proof.exe` + `application/pdf` ile yükleme dene -> `400`
2. `proof.pdf` + `text/plain` ile yükleme dene -> `400`
3. Geçerli `pdf/docx/xlsx/jpg/png` dosyaları -> başarılı

## 5. Go / No-Go kararı

1. Tüm otomatik kapılar yeşil
2. Rol/yetki testlerinde beklenen `403` sınırları çalışıyor
3. Dosya oluşturma + ilk görev akışı kullanıcıya doğru mesaj veriyor
4. Belge yükleme validasyonu yanlış formatları engelliyor

Bu 4 madde tamamlanmadan yayın yapılmaz.
