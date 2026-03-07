export default function SmmCalculatorPage() {
  return (
    <section className="space-y-3">
      <h1 className="text-xl font-semibold text-[var(--main-text,var(--text))]">SMM Araci</h1>
      <p className="rounded-[var(--radius-xs)] border border-[color-mix(in_srgb,var(--warning),white_58%)] bg-[color-mix(in_srgb,var(--warning),white_88%)] px-3 py-2 text-sm text-[var(--warning)]">
        Bu arac gecici olarak sade moda alindi. Editor akisi stabil hale getirildikten sonra
        hesaplama formu yeniden aktif edilecek.
      </p>
    </section>
  );
}
