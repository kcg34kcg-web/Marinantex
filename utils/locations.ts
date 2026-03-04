export type LocationType = 'country' | 'city' | 'district' | 'venue';

export interface LocationItem {
  name: string;
  type: LocationType;
  detail?: string;
}

export const ALL_LOCATIONS: LocationItem[] = [
  { name: 'Türkiye', type: 'country', detail: 'Ülke' },
  { name: 'İstanbul', type: 'city', detail: 'İl' },
  { name: 'Ankara', type: 'city', detail: 'İl' },
  { name: 'İzmir', type: 'city', detail: 'İl' },
  { name: 'Kadıköy', type: 'district', detail: 'İstanbul' },
  { name: 'Beşiktaş', type: 'district', detail: 'İstanbul' },
  { name: 'Çankaya', type: 'district', detail: 'Ankara' },
  { name: 'Bornova', type: 'district', detail: 'İzmir' },
  { name: 'İstanbul Adliyesi', type: 'venue', detail: 'Çağlayan' },
  { name: 'Ankara Adliyesi', type: 'venue', detail: 'Sıhhiye' },
  { name: 'İzmir Adliyesi', type: 'venue', detail: 'Bayraklı' },
  { name: 'Türkiye Barolar Birliği', type: 'venue', detail: 'Ankara' },
  { name: 'Galatasaray Üniversitesi', type: 'venue', detail: 'İstanbul' },
  { name: 'Ankara Üniversitesi Hukuk Fakültesi', type: 'venue', detail: 'Ankara' },
];

