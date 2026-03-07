# UDF External Validation Checklist (Manual Gate)

Bu kontrol listesi, kapali format nedeniyle otomatik testlerle dogrulanamayan hedef uygulama uyumlulugunu manuel olarak dogrulamak icin kullanilir.

## 1) Hazirlik

- Editor'den `UDF indir` ile `.udf` dosyasi olustur.
- Test seti olarak asagidaki 10 fixture senaryosunu kullan:
  - `tests/fixtures/udf-golden/documents.json`

## 2) Hedef uygulamada acilis testi

- `.udf` dosyasi acilabiliyor mu?
- Acilis sirasinda hata/uyari cikariyor mu?
- Dosya bozuk/okunamadi hatasi var mi?

## 3) Bicim sadakati kontrolu

Her senaryoda asagidaki alanlari kontrol et:

- Paragraf yapisi
- Bos satirlar
- Tab karakterleri
- Hizalama (sol/orta/sag/justify)
- Font ailesi / font boyutu
- Kalin / italik / altcizili
- Tablo satir-hucre yapisi

## 4) Kopyalama modlari

- `UDF iç kopyala`:
  - uygulama ici paste ile yapi korunuyor mu?
- `UYAP uyumlu kopyala`:
  - hedef uygulamaya paste sirasinda bozulma kabul edilebilir seviyede mi?

## 5) Kabul kriteri

- Kritik hata: dosya acilmiyor, tamamen bozuk, tablo kaybi.
- Orta seviye: font fallback veya span sadeleme (uyari ile kabul).
- Dusuk seviye: mikro bosluk/line-height farklari.

## 6) Sonuc kaydi

Her fixture icin asagidaki tabloyu doldur:

| Senaryo | Acilis | Paragraf | Tablo | Font | Kopyala Ic | Kopyala UYAP | Not |
|---|---|---|---|---|---|---|---|
| scenario-01 | PASS/FAIL | PASS/FAIL | PASS/FAIL | PASS/FAIL | PASS/FAIL | PASS/FAIL | ... |

Bu kontrol listesi CI'yi degistirmez; release oncesi manuel kalite kapisi olarak kullanilir.
