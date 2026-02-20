"""
Kaynak Envanteri — Step 2: Mevzuat ve İçtihat Kaynak Matrisi
=============================================================
Türk hukuku RAG sisteminde kullanılan tüm resmi kaynakların kataloğu.

Her kaynak için:
  - Kanonik taban URL
  - Lisans türü ve lisans notları
  - Belge türü (MEVZUAT | ICTIHAT | IKINCIL)
  - Otorite düzeyi (CourtLevel veya NormHierarchy string'i)
  - Zorunlu atıf formatı

Kullanım:
    from infrastructure.legal.source_registry import KAYNAK_MATRISI, get_source
    entry = get_source("resmi_gazete")
    print(entry.license)          # "Kamu Malı — Telif hakkı yok"
    print(entry.base_url)         # "https://www.resmigazete.gov.tr"

Lisans Politikası:
    Türkiye Cumhuriyeti'nin resmi hukuki metinleri 5846 sayılı Fikir ve Sanat
    Eserleri Kanunu md. 31 kapsamında devlet eseri olarak kamu malıdır; telif
    hakkı koruması yoktur.  Yargı kararları da aynı şekilde kamu malıdır.
    Üçüncü taraf platformlar (Kazancı, Lexpera vb.) kendi veri tabanı
    düzenlemelerini koruma altına alabilir; ham metin kamu malıdır.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional


# ============================================================================
# Veri Modeli
# ============================================================================

@dataclass(frozen=True)
class SourceEntry:
    """
    Tek bir hukuki kaynak kaydı.

    Attributes:
        source_id:        Sistemde kullanılan kısa tanımlayıcı (slug).
        name:             Kaynağın tam Türkçe adı.
        base_url:         Kanonik taban URL (erişim için kullanılır).
        license:          Kısa lisans açıklaması.
        license_url:      Lisans veya kullanım koşulları URL'i (opsiyonel).
        license_notes:    Ek lisans notları veya kısıtlamalar.
        doc_type:         Belge sınıfı: "MEVZUAT" | "ICTIHAT" | "IKINCIL".
        authority_level:  CourtLevel veya NormHierarchy string değeri.
        description:      Kaynak hakkında kısa açıklama.
        citation_format:  Standart atıf formatı (örnek ile).
        is_official:      True → resmi devlet kaynağı; False → üçüncü taraf.
        tags:             Arama/filtreleme için etiketler.
    """
    source_id:        str
    name:             str
    base_url:         str
    license:          str
    doc_type:         str
    authority_level:  str
    description:      str
    citation_format:  str
    license_url:      Optional[str] = None
    license_notes:    str = ""
    is_official:      bool = True
    tags:             List[str] = field(default_factory=list)


# ============================================================================
# Kaynak Matrisi
# ============================================================================

KAYNAK_MATRISI: Dict[str, SourceEntry] = {

    # ── Mevzuat Kaynakları ─────────────────────────────────────────────────────

    "resmi_gazete": SourceEntry(
        source_id="resmi_gazete",
        name="Resmî Gazete",
        base_url="https://www.resmigazete.gov.tr",
        license="Kamu Malı — Telif hakkı yok (5846 sk. md. 31)",
        license_url="https://www.mevzuat.gov.tr/hakkimizda",
        license_notes=(
            "T.C. Cumhurbaşkanlığı Mevzuat Bilgi Sistemi bünyesinde yayımlanan "
            "resmi metinler, 5846 sayılı Kanun'un 31. maddesi uyarınca devlet "
            "eseri sayılır ve serbest kullanıma açıktır."
        ),
        doc_type="MEVZUAT",
        authority_level="KANUN",
        description=(
            "T.C. Resmî Gazete — kanun, CBK, yönetmelik, tebliğ ve diğer "
            "resmi mevzuatın yayım organı.  Mevzuat metinlerinin birincil kaynağı."
        ),
        citation_format="RG, DD.AA.YYYY, Sayı: NNNNN",
        is_official=True,
        tags=["mevzuat", "kanun", "cbk", "yönetmelik", "tebliğ", "birincil"],
    ),

    "mevzuat_gov_tr": SourceEntry(
        source_id="mevzuat_gov_tr",
        name="Cumhurbaşkanlığı Mevzuat Bilgi Sistemi",
        base_url="https://www.mevzuat.gov.tr",
        license="Kamu Malı — Telif hakkı yok (5846 sk. md. 31)",
        license_url="https://www.mevzuat.gov.tr/hakkimizda",
        license_notes=(
            "Konsolide mevzuat metinleri kamu malıdır.  Veri tabanı yapısı "
            "ve arama motoru tasarımı telif koruması kapsamında olabilir."
        ),
        doc_type="MEVZUAT",
        authority_level="KANUN",
        description=(
            "T.C. Cumhurbaşkanlığı Mevzuat Bilgi Sistemi — yürürlükteki "
            "kanun, CBK, yönetmelik, tebliğ ve yönergelerin konsolide "
            "tam metinlerini barındıran resmi portal."
        ),
        citation_format="Kanun No: NNNN, md. N (mevzuat.gov.tr)",
        is_official=True,
        tags=["mevzuat", "kanun", "cbk", "yönetmelik", "konsolide"],
    ),

    "anayasa_mahkemesi_mevzuat": SourceEntry(
        source_id="anayasa_mahkemesi_mevzuat",
        name="Anayasa Mahkemesi — Türkiye Cumhuriyeti Anayasası",
        base_url="https://www.anayasa.gov.tr",
        license="Kamu Malı — Telif hakkı yok (5846 sk. md. 31)",
        doc_type="MEVZUAT",
        authority_level="ANAYASA",
        description=(
            "T.C. Anayasası (1982) — Türk hukukunun en üst normu.  "
            "Anayasa Mahkemesi tarafından yönetilen resmi metin."
        ),
        citation_format="Anayasa md. N",
        is_official=True,
        tags=["anayasa", "temel_hak", "norm_hiyerarşisi", "birincil"],
    ),

    # ── İçtihat Kaynakları ─────────────────────────────────────────────────────

    "yargitay": SourceEntry(
        source_id="yargitay",
        name="Yargıtay — Kararlar Bilgi Bankası",
        base_url="https://karararama.yargitay.gov.tr",
        license="Kamu Malı — Telif hakkı yok (5846 sk. md. 31)",
        license_url="https://karararama.yargitay.gov.tr/yardim",
        license_notes=(
            "Yargıtay kararları devlet eseri olup serbest kullanıma açıktır.  "
            "Karararama portalının yazılım altyapısı telif kapsamındadır; "
            "karar metinleri değildir."
        ),
        doc_type="ICTIHAT",
        authority_level="YARGITAY_DAIRE",
        description=(
            "Türkiye Yargıtay'ı resmî karar arama portalı.  Hukuk ve ceza "
            "dairelerinin kesinleşmiş kararlarını barındırır."
        ),
        citation_format="Yargıtay N. HD, E. YYYY/N, K. YYYY/N, DD.AA.YYYY",
        is_official=True,
        tags=["yargıtay", "içtihat", "temyiz", "karar"],
    ),

    "yargitay_ibk": SourceEntry(
        source_id="yargitay_ibk",
        name="Yargıtay — İçtihadı Birleştirme Kurulu Kararları",
        base_url="https://karararama.yargitay.gov.tr",
        license="Kamu Malı — Telif hakkı yok (5846 sk. md. 31)",
        doc_type="ICTIHAT",
        authority_level="YARGITAY_IBK",
        description=(
            "Yargıtay İçtihadı Birleştirme Kurulu (İBK) kararları — tüm "
            "Yargıtay daireleri açısından bağlayıcı emsal kararlar. "
            "Retrieval katmanında hard-boost uygulanır."
        ),
        citation_format="Yargıtay İBK, E. YYYY/N, K. YYYY/N, DD.AA.YYYY",
        is_official=True,
        tags=["yargıtay", "ibk", "bağlayıcı", "içtihat_birleştirme"],
    ),

    "yargitay_hgk": SourceEntry(
        source_id="yargitay_hgk",
        name="Yargıtay — Hukuk Genel Kurulu Kararları",
        base_url="https://karararama.yargitay.gov.tr",
        license="Kamu Malı — Telif hakkı yok (5846 sk. md. 31)",
        doc_type="ICTIHAT",
        authority_level="YARGITAY_HGK",
        description=(
            "Yargıtay Hukuk Genel Kurulu (HGK) kararları — daire kararlarına "
            "karşı yapılan itirazlarda verilmiş, güçlü emsal niteliği taşıyan "
            "kararlar.  Hard-boost uygulanır."
        ),
        citation_format="Yargıtay HGK, E. YYYY/N, K. YYYY/N, DD.AA.YYYY",
        is_official=True,
        tags=["yargıtay", "hgk", "bağlayıcı", "genel_kurul"],
    ),

    "yargitay_cgk": SourceEntry(
        source_id="yargitay_cgk",
        name="Yargıtay — Ceza Genel Kurulu Kararları",
        base_url="https://karararama.yargitay.gov.tr",
        license="Kamu Malı — Telif hakkı yok (5846 sk. md. 31)",
        doc_type="ICTIHAT",
        authority_level="YARGITAY_CGK",
        description=(
            "Yargıtay Ceza Genel Kurulu (CGK) kararları — ceza yargılamasında "
            "bağlayıcı emsal niteliği taşır.  Hard-boost uygulanır."
        ),
        citation_format="Yargıtay CGK, E. YYYY/N, K. YYYY/N, DD.AA.YYYY",
        is_official=True,
        tags=["yargıtay", "cgk", "bağlayıcı", "ceza"],
    ),

    "danistay": SourceEntry(
        source_id="danistay",
        name="Danıştay — Karar Bilgi Bankası",
        base_url="https://karararama.danistay.gov.tr",
        license="Kamu Malı — Telif hakkı yok (5846 sk. md. 31)",
        license_url="https://karararama.danistay.gov.tr",
        doc_type="ICTIHAT",
        authority_level="DANISTAY",
        description=(
            "Danıştay resmî karar arama portalı.  İdare ve vergi "
            "yargılamasına ilişkin daire kararlarını barındırır."
        ),
        citation_format="Danıştay N. Daire, E. YYYY/N, K. YYYY/N, DD.AA.YYYY",
        is_official=True,
        tags=["danıştay", "idare", "vergi", "içtihat"],
    ),

    "danistay_iddk": SourceEntry(
        source_id="danistay_iddk",
        name="Danıştay — İdari Dava Daireleri Kurulu Kararları",
        base_url="https://karararama.danistay.gov.tr",
        license="Kamu Malı — Telif hakkı yok (5846 sk. md. 31)",
        doc_type="ICTIHAT",
        authority_level="DANISTAY_IDDK",
        description=(
            "Danıştay İdari Dava Daireleri Kurulu (İDDK) kararları — idare "
            "hukukunda bağlayıcı emsal niteliği taşır.  Hard-boost uygulanır."
        ),
        citation_format="Danıştay İDDK, E. YYYY/N, K. YYYY/N, DD.AA.YYYY",
        is_official=True,
        tags=["danıştay", "iddk", "bağlayıcı", "idare"],
    ),

    "anayasa_mahkemesi": SourceEntry(
        source_id="anayasa_mahkemesi",
        name="Anayasa Mahkemesi — Kararlar",
        base_url="https://www.anayasa.gov.tr/tr/kararlar-bilgi-bankasi/",
        license="Kamu Malı — Telif hakkı yok (5846 sk. md. 31)",
        license_url="https://www.anayasa.gov.tr",
        license_notes=(
            "AYM kararları (iptal, itiraz, bireysel başvuru) devlet eseridir.  "
            "İptal kararları Resmî Gazete'de yayımlanarak kesinleşir "
            "(Anayasa md. 153/2)."
        ),
        doc_type="ICTIHAT",
        authority_level="AYM",
        description=(
            "Anayasa Mahkemesi kararları — iptal, itiraz ve bireysel başvuru "
            "kararları.  Türk hukukunun en üst yargı organı; kararları "
            "kesindir ve tüm mahkemeler için bağlayıcıdır (Anayasa md. 153). "
            "Hard-boost uygulanır."
        ),
        citation_format="AYM, E. YYYY/N, K. YYYY/N, RG DD.AA.YYYY, Sayı: NNNNN",
        is_official=True,
        tags=["aym", "anayasa", "iptal", "bireysel_başvuru", "bağlayıcı"],
    ),

    # ── İkincil / Akademik Kaynaklar ──────────────────────────────────────────

    "uyap": SourceEntry(
        source_id="uyap",
        name="UYAP — Ulusal Yargı Ağı Bilişim Sistemi",
        base_url="https://www.uyap.gov.tr",
        license="Kısıtlı — Yalnızca yetkili kullanıcılar (avukat, savcı, hâkim)",
        license_notes=(
            "UYAP'tan alınan belgeler yalnızca yetkili kullanıcılar tarafından "
            "yasal amaçlarla kullanılabilir.  İzinsiz paylaşım yasaktır."
        ),
        doc_type="IKINCIL",
        authority_level="ILKDERECE",
        description=(
            "Adalet Bakanlığı'na bağlı Ulusal Yargı Ağı — derdest ve "
            "kesinleşmiş dava dosyaları, tebligatlar ve mahkeme kararları.  "
            "Yalnızca yetki verilmiş kullanıcılar erişebilir."
        ),
        citation_format="UYAP Dava No: YYYY/N (Mahkeme Adı)",
        is_official=True,
        tags=["uyap", "dava_dosyası", "kısıtlı", "birinci_derece"],
    ),

    "kazanci": SourceEntry(
        source_id="kazanci",
        name="Kazancı Hukuk — İçtihat ve Mevzuat Bankası",
        base_url="https://www.kazanci.com.tr",
        license="Ticari Lisans — Abonelik gerekli",
        license_url="https://www.kazanci.com.tr/kullanim-kosullari",
        license_notes=(
            "Kazancı veri tabanı özel lisanslıdır.  Ham yargı kararları kamu "
            "malı olsa da Kazancı'nın özet, başlık ve sınıflama katkıları "
            "telif koruması kapsamındadır.  Abonelik olmaksızın içerik "
            "kopyalanamaz veya yeniden dağıtılamaz."
        ),
        doc_type="ICTIHAT",
        authority_level="YARGITAY_DAIRE",
        description=(
            "Kazancı İçtihat ve Mevzuat Bankası — Yargıtay, Danıştay, AYM "
            "ve ilk derece mahkeme kararlarını kapsayan kapsamlı özel "
            "hukuki veri tabanı."
        ),
        citation_format="Kazancı: [Mahkeme], E. YYYY/N, K. YYYY/N",
        is_official=False,
        tags=["içtihat", "mevzuat", "özel", "abonelik"],
    ),

    "lexpera": SourceEntry(
        source_id="lexpera",
        name="Lexpera — Hukuki Bilgi Sistemi (Legal Studio)",
        base_url="https://www.lexpera.com.tr",
        license="Ticari Lisans — Abonelik gerekli",
        license_url="https://www.lexpera.com.tr/kullanim-sozlesmesi",
        license_notes=(
            "On İki Levha Yayıncılık'ın içerik katkıları telif koruması "
            "altındadır.  Kamu malı olan ham karar metinleri serbestçe "
            "kullanılabilir; ancak Lexpera'nın özel düzenlemeleri ve "
            "yorumları kullanılamaz."
        ),
        doc_type="IKINCIL",
        authority_level="YARGITAY_DAIRE",
        description=(
            "Lexpera (On İki Levha) — kanun şerhleri, içtihat derlemeleri, "
            "Yargıtay/Danıştay kararları ve akademik makalelerden oluşan "
            "kapsamlı hukuki bilgi platformu."
        ),
        citation_format="Lexpera: [Mahkeme], E. YYYY/N, K. YYYY/N",
        is_official=False,
        tags=["içtihat", "şerh", "akademik", "özel", "abonelik"],
    ),
}


# ============================================================================
# Yardımcı Fonksiyonlar
# ============================================================================

def get_source(source_id: str) -> Optional[SourceEntry]:
    """
    source_id ile kaynak kaydını döndürür.

    Args:
        source_id: KAYNAK_MATRISI anahtarı (ör. "resmi_gazete", "yargitay").

    Returns:
        SourceEntry veya None (bulunamazsa).
    """
    return KAYNAK_MATRISI.get(source_id)


def get_sources_by_doc_type(doc_type: str) -> List[SourceEntry]:
    """
    Belge türüne göre kaynak listesi döndürür.

    Args:
        doc_type: "MEVZUAT" | "ICTIHAT" | "IKINCIL"

    Returns:
        Eşleşen SourceEntry listesi.
    """
    return [e for e in KAYNAK_MATRISI.values() if e.doc_type == doc_type]


def get_binding_sources() -> List[SourceEntry]:
    """
    Hard-boost uygulanacak bağlayıcı içtihat kaynaklarını döndürür.
    (AYM, İBK, HGK, CGK, DANISTAY_IDDK)
    """
    _BINDING = {"AYM", "YARGITAY_IBK", "YARGITAY_HGK", "YARGITAY_CGK", "DANISTAY_IDDK"}
    return [e for e in KAYNAK_MATRISI.values() if e.authority_level in _BINDING]


def get_official_sources() -> List[SourceEntry]:
    """Yalnızca resmi devlet kaynaklarını döndürür (is_official=True)."""
    return [e for e in KAYNAK_MATRISI.values() if e.is_official]


def infer_source_id(url: str) -> Optional[str]:
    """
    URL'den kaynak ID'sini çıkarmaya çalışır.

    Tam eşleşme garantisi verilmez; en iyi çaba esasına dayanır.
    Eşleşme bulunamazsa None döner.

    Args:
        url: Dokümanın source_url değeri.

    Returns:
        KAYNAK_MATRISI anahtarı veya None.
    """
    if not url:
        return None
    lower = url.lower()
    _URL_HINTS: List[tuple[str, str]] = [
        ("resmigazete.gov.tr",         "resmi_gazete"),
        ("mevzuat.gov.tr",             "mevzuat_gov_tr"),
        ("anayasa.gov.tr/tr/kararlar", "anayasa_mahkemesi"),
        ("anayasa.gov.tr",             "anayasa_mahkemesi_mevzuat"),
        ("karararama.yargitay.gov.tr", "yargitay"),
        ("yargitay.gov.tr",            "yargitay"),
        ("karararama.danistay.gov.tr", "danistay"),
        ("danistay.gov.tr",            "danistay"),
        ("uyap.gov.tr",                "uyap"),
        ("kazanci.com.tr",             "kazanci"),
        ("lexpera.com.tr",             "lexpera"),
    ]
    for hint, sid in _URL_HINTS:
        if hint in lower:
            return sid
    return None
