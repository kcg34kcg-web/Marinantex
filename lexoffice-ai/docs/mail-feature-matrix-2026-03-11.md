# Mail Feature Matrix (2026-03-11)

Bu dokuman, istenen 4-16 kapsamini mevcut LexOffice AI mail sistemiyle eslestirir.

Durum etiketleri:
- `VAR`: Uygulamada calisiyor.
- `KISMI`: Temel altyapi var, kapsam eksik.
- `PLAN`: Henüz yok, backlog'a alindi.

## 4) Mail okuma
- `[VAR]` Mail icerigini acma
- `[VAR]` HTML mail goruntuleme
- `[VAR]` Duz metin mail goruntuleme
- `[VAR]` Uzun mailde duzgun kaydirma
- `[VAR]` Mail baslik bilgilerini gosterme
- `[VAR]` Gonderen bilgisi gosterme
- `[VAR]` Alici bilgisi gosterme
- `[VAR]` CC bilgisi gosterme
- `[VAR]` BCC bilgisi gosterme (uygunsa, veride varsa)
- `[VAR]` Ekleri goruntuleme
- `[VAR]` Ekleri indirme
- `[VAR]` Resimleri goster/gizle
- `[VAR]` Harici icerikleri guvenli yukleme
- `[VAR]` Maili yeni pencerede acma

## 5) Mail yazma
- `[VAR]` Yeni mail olusturma
- `[VAR]` Kime alani
- `[VAR]` CC alani
- `[VAR]` BCC alani
- `[VAR]` Konu alani
- `[VAR]` Mail govdesi yazma
- `[VAR]` Zengin metin editoru
- `[VAR]` Duz metin modu
- `[VAR]` Dosya eki ekleme
- `[VAR]` Resim ekleme
- `[VAR]` Surukle birak dosya yukleme
- `[VAR]` Taslak olarak kaydetme
- `[VAR]` Otomatik taslak kaydi
- `[VAR]` Gonder butonu
- `[VAR]` Zamanlanmis gonderim
- `[VAR]` Gondermeyi geri alma (undo send)
- `[VAR]` Imza ekleme
- `[VAR]` Sablon kullanma
- `[VAR]` Yazim denetimi
- `[VAR]` Link ekleme
- `[VAR]` Madde isaretli liste
- `[VAR]` Numarali liste
- `[VAR]` Kalin/italik/alti cizili yazi
- `[VAR]` Yazi hizalama
- `[VAR]` Dosya boyutu kontrolu
- `[VAR]` Buyuk ek uyarisi
- `[VAR]` Konu bossa uyari verme
- `[VAR]` Ek demis ama ek yoksa uyari verme

## 6) Mail islemleri
- `[VAR]` Yanitla
- `[VAR]` Tumune yanitla
- `[VAR]` Ilet
- `[VAR]` Sil
- `[VAR]` Arsivle
- `[VAR]` Spam olarak isaretle
- `[VAR]` Spamdan cikar
- `[VAR]` Okundu olarak isaretle
- `[VAR]` Okunmadi olarak isaretle
- `[VAR]` Yildiz ekle/kaldir
- `[VAR]` Onemli olarak isaretle
- `[PLAN]` Klasore tasi
- `[VAR]` Etiket ekle
- `[VAR]` Toplu secim yap
- `[VAR]` Toplu silme
- `[VAR]` Toplu arsivleme
- `[VAR]` Toplu okundu isaretleme
- `[VAR]` Toplu tasima
- `[VAR]` Mail yazdirma
- `[VAR]` Maili PDF olarak disa aktarma

## 7) Arama ve filtreleme
- `[VAR]` Mail icinde arama
- `[VAR]` Gonderen adina gore arama
- `[VAR]` Konuya gore arama
- `[VAR]` Icerikte kelime arama
- `[VAR]` Tarih araligina gore arama
- `[VAR]` Ekli mailleri filtreleme
- `[VAR]` Okunmamis filtreleme
- `[VAR]` Yildizli filtreleme
- `[VAR]` Belirli klasorde arama (mailbox scope)
- `[VAR]` Gelismis arama paneli
- `[VAR]` Kaydedilmis aramalar

## 8) Bildirimler
- `[VAR]` Yeni mail bildirimi
- `[VAR]` Masaustu bildirimi
- `[PLAN]` Mobil push bildirimi
- `[VAR]` Bildirim sesi
- `[VAR]` Bildirim ac/kapat
- `[VAR]` Sadece onemli mailler icin bildirim
- `[VAR]` Sessiz saatler ayari

## 9) Rehber ve kisi yonetimi
- `[VAR]` Kisi listesi
- `[VAR]` Kisi ekleme
- `[VAR]` Kisi duzenleme
- `[VAR]` Kisi silme
- `[VAR]` Otomatik onerilen kisiler
- `[VAR]` Son kullanilan alicilar
- `[VAR]` Mail yazarken otomatik tamamlama
- `[PLAN]` Kisi gruplari olusturma

## 10) Guvenlik
- `[VAR]` Sifreleri guvenli saklama
- `[VAR]` Oturum yonetimi
- `[VAR]` Cok faktorlu dogrulama
- `[VAR]` Supheli giris algilama
- `[VAR]` Cihaz oturumu goruntuleme
- `[VAR]` Oturumlardan cikis yapma
- `[PLAN]` Spam filtreleme
- `[PLAN]` Phishing uyarisi
- `[VAR]` Zararli ek taramasi
- `[PLAN]` Link guvenlik kontrolu
- `[VAR]` Rate limiting
- `[PLAN]` Captcha korumasi
- `[VAR]` Yetkisiz erisim loglari
- `[VAR]` Veri sifreleme
- `[VAR]` HTTPS zorunlulugu
- `[VAR]` KVKK/GDPR uyumu

## 11) Ayarlar
- `[PLAN]` Imza ayari
- `[PLAN]` Varsayilan yazi tipi ayari
- `[PLAN]` Varsayilan gonderici hesabi
- `[PLAN]` Otomatik yanitlayici
- `[PLAN]` Mail yonlendirme
- `[PLAN]` Filtre kurallari
- `[PLAN]` Engellenen gonderenler
- `[PLAN]` Beyaz liste
- `[PLAN]` Kara liste
- `[VAR]` Tema ayari
- `[PLAN]` Bildirim ayari
- `[VAR]` Gorunum ayari
- `[PLAN]` Konusma gorunumu ac/kapat
- `[PLAN]` Okuma paneli konumu

## 12) Gelismis verimlilik ozellikleri
- `[VAR]` Klavye kisayollari
- `[VAR]` Hizli islem butonlari
- `[PLAN]` Surukle birak ile tasima
- `[PLAN]` Pinleme
- `[PLAN]` Sonra oku
- `[PLAN]` Hatirlatici kurma
- `[PLAN]` Takvim entegrasyonu
- `[VAR]` Gorev olusturma
- `[PLAN]` Not ekleme
- `[PLAN]` Sik kullanilan sablonlar
- `[PLAN]` Mail takip etiketi
- `[PLAN]` Gonderim zaman onerisi

## 13) Yapay zeka ozellikleri
- `[VAR]` Mail ozetleme
- `[VAR]` Uzun konusmayi kisa ozet yapma
- `[VAR]` Akilli yanit onerileri
- `[VAR]` Profesyonel cevap olusturma
- `[VAR]` Samimi cevap olusturma
- `[VAR]` Metni yeniden yazma
- `[VAR]` Yazim ve dil bilgisi duzeltme
- `[VAR]` Konu satiri onerme
- `[VAR]` Maili kisaltma
- `[VAR]` Maili uzatma
- `[VAR]` Ceviri yapma
- `[VAR]` Mail tonunu degistirme
- `[PLAN]` Oncelikli mailleri tespit etme
- `[PLAN]` Spam olabilecek mailleri isaretleme
- `[PLAN]` Gorev cikarimi yapma
- `[PLAN]` Toplanti istegini algilama
- `[PLAN]` Tarih/saat bilgisini cikarima
- `[VAR]` Ek unutulmus mu kontrol etme
- `[PLAN]` Akilli klasorleme
- `[PLAN]` Dogal dille arama
- `[PLAN]` “Bana gecen hafta Ahmet’in attigi faturayi bul” gibi arama destegi
- `[PLAN]` Otomatik etiket onerisi
- `[VAR]` Mail cevap taslagi olusturma
- `[VAR]` Konusma dili / resmi dil donusumu

## 14) Yonetim paneli varsa
- `[VAR]` Kullanici yonetimi
- `[VAR]` Rol yonetimi
- `[VAR]` Yetki yonetimi
- `[VAR]` Sistem loglari
- `[PLAN]` Spam loglari
- `[VAR]` Hata loglari
- `[PLAN]` Depolama kullanimi goruntuleme
- `[PLAN]` Sunucu ayarlari
- `[PLAN]` SMTP test ekrani
- `[PLAN]` Yedekleme yonetimi
- `[PLAN]` Sistem saglik durumu ekrani

## 15) Mobil ve performans
- `[VAR]` Responsive tasarim
- `[VAR]` Mobil uyum
- `[VAR]` Hizli acilis
- `[VAR]` Lazy loading
- `[VAR]` Offline taslak destegi
- `[PLAN]` Dusuk internet hizinda calisma
- `[VAR]` Onbellekleme
- `[VAR]` Buyuk mail listelerinde performans optimizasyonu

## 16) Olmazsa olmaz teknik parcalar
- `[VAR]` Kullanici modeli
- `[VAR]` Mail hesabi modeli
- `[VAR]` Mail modeli
- `[VAR]` Ek dosya modeli
- `[VAR]` Klasor/etiket modeli
- `[VAR]` Kisi modeli
- `[PLAN]` Filtre kurali modeli
- `[VAR]` Bildirim sistemi
- `[VAR]` Arama altyapisi
- `[VAR]` Dosya yukleme sistemi
- `[VAR]` Arka plan kuyruk sistemi
- `[VAR]` Mail senkronizasyon servisi
- `[VAR]` Hata yonetimi
- `[VAR]` Loglama sistemi
- `[VAR]` Yetkilendirme sistemi
- `[VAR]` API katmani
- `[VAR]` Admin paneli
- `[VAR]` Test altyapisi

## Kisa Yol Haritasi
- `Sprint 1`: Mail islemleri (reply/reply-all/forward), sil/arsiv/spam, yildiz/onemli, toplu aksiyonlar.
- `Sprint 2`: Gelismis arama paneli, tarih/ek/yildiz filtreleri, kaydedilmis aramalar.
- `Sprint 3`: Bildirim merkezi, imza/sablon, zamanlanmis gonderim ve undo send.
- `Sprint 4`: Spam/phishing/link guvenlik katmani, admin operasyon panelleri.
