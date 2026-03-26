export interface Article {
  id: string;
  category: string;
  title: string;
  subtitle: string;
  readTime: string;
  content: string;
}

export const ARTICLE_DATA: Article[] = [
  {
    id: 'procedural-discipline',
    category: 'Usul',
    title: 'Dava dosyasinda prosedurel disiplin',
    subtitle: 'Takvim, sure ve delil akisini ayni tabloda yonetin.',
    readTime: '3 dk',
    content:
      '<p>Basarili bir dava yonetimi, sadece hukuki arguman kalitesine degil; surelerin, evrak akisinin ve delil zincirinin temiz tutulmasina da baglidir.</p><p>Her yeni belge icin tarih, kaynak, ilgili taraf ve sonraki is adimini not etmek; savunma stratejisinin dagilmasini onler.</p><p>Ozellikle istinaf ve temyiz oncesi, dosya ozetini tek sayfalik bir operasyon notuna indirmek ekibin hizini belirgin bicimde artirir.</p>',
  },
  {
    id: 'client-communication',
    category: 'Iletisim',
    title: 'Muvekkil ile beklenti yonetimi',
    subtitle: 'Belirsizligi azaltan iletisim, dava kalitesini de artirir.',
    readTime: '2 dk',
    content:
      '<p>Muvekkil ile yapilan iletisimde en sik sorun, hukuki surecin hizi ile muvekkilin beklentisi arasindaki farktan dogar.</p><p>Bu nedenle her gorusmede uc baslik sabit kalmalidir: bugun ne oldu, bir sonraki adim ne, riskler nasil degisti.</p><p>Kisa ama duzenli durum guncellemeleri, son dakika panigini ve gereksiz tekrar yazismalarini azaltir.</p>',
  },
  {
    id: 'evidence-hygiene',
    category: 'Delil',
    title: 'Delil hijyeni ve versiyon takibi',
    subtitle: 'Ayni belgenin farkli kopyalari yerine tek dogru kaynak kullanin.',
    readTime: '4 dk',
    content:
      '<p>Delil seti buyudukce en kritik risklerden biri, ekip icinde ayni belgenin farkli versiyonlarinin dolasmaya baslamasidir.</p><p>Her dosya icin tek bir kanonik adlandirma, sabit referans kodu ve degisiklik gecmisi tutulmalidir.</p><p>Bu disiplin sadece incelemeyi kolaylastirmaz; ayni zamanda mahkemeye sunulacak anlatinin tutarliligini da korur.</p>',
  },
];
