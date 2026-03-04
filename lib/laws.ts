export interface LawItem {
  id: string;
  label: string;
  text: string;
}

export const LAW_DATA: LawItem[] = [
  {
    id: "tbk-117",
    label: "TBK 117",
    text: "Borc ifa edilmezse alacakli temerrut hukukundan dogan haklarini kullanabilir.",
  },
  {
    id: "hmk-119",
    label: "HMK 119",
    text: "Dava dilekcesinde taraflar, talep sonucu ve dayanaklar gibi zorunlu unsurlar bulunur.",
  },
  {
    id: "hmk-127",
    label: "HMK 127",
    text: "Davalinin cevap dilekcesi suresi, dava dilekcesinin tebliginden itibaren iki haftadir.",
  },
  {
    id: "tmk-6",
    label: "TMK 6",
    text: "Kanunda aksine bir hukum bulunmadikca taraflardan her biri hakkini dayandirdigi olgulari ispatla yukumludur.",
  },
  {
    id: "tbk-49",
    label: "TBK 49",
    text: "Kusurlu ve hukuka aykiri bir fiille baskasina zarar veren, bu zarari gidermekle yukumludur.",
  },
];

