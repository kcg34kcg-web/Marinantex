# HTTP-only Token Migration Plan (Editor)

## Hedef
- `mx_access_token` ve `mx_tenant_id` degerlerini `localStorage` yerine server-set, `HttpOnly` cookie uzerinden kullanmak.
- XSS durumunda token calinabilirligini azaltmak.
- Editor API akisini bozmadan kademeli gecis yapmak.

## Faz 0: Hazirlik
- Tum istemci kodunda token okunan noktalarin envanterini cikar:
  - `apps/web/components/editor/editor-unified.tsx`
  - `apps/web/components/editor/editor-documents-home.tsx`
  - `apps/web/lib/editor/api-client.ts`
- API tarafinda `x-tenant-id` zorunlulugunu cookie fallback ile destekleyecek ara katman hazirla.

## Faz 1: Cift Mod (Backward-compatible)
- Login/session endpointi cookie set etsin:
  - `Set-Cookie: mx_access_token=...; HttpOnly; Secure; SameSite=Lax; Path=/`
  - `Set-Cookie: mx_tenant_id=...; HttpOnly; Secure; SameSite=Lax; Path=/`
- Frontend `fetch` cagrilarinda `credentials: "include"` kullan.
- API request pipeline:
  - `Authorization` header varsa oldugu gibi kullan.
  - Yoksa `mx_access_token` cookie’den bearer uret.
  - `x-tenant-id` header yoksa `mx_tenant_id` cookie’den al.
- Bu fazda localStorage okumasi kaldirilmaz; fallback olarak kalir.

## Faz 2: Frontend Temizleme
- `readApiCtx()` fonksiyonlarindan token/tenant localStorage okumasi kaldir.
- Editor ekraninda API erisilebilirlik kontrolunu cookie tabanli probe ile yap:
  - Hafif endpoint (`/documents?limit=1`) ile auth durumunu belirle.
- Session degisikliklerinde `storage` event yerine `focus + lightweight probe` kullan.

## Faz 3: CSRF Sertlestirme
- Cookie auth icin CSRF korumasi ekle:
  - `SameSite=Lax` + custom `X-CSRF-Token` header (double submit cookie modeli).
  - Tum state-changing endpointlerde CSRF dogrulamasi uygula.
- Public endpointler (`/share-links/public/*`) CSRF kapsam disi kalabilir (auth gerektirmedigi icin), ama rate-limit zorunlu olsun.

## Faz 4: CSP ve Tarayici Guvenlik Basliklari
- CSP’yi report-only modda ac:
  - `default-src 'self'`
  - `object-src 'none'`
  - `base-uri 'self'`
  - `frame-ancestors 'none'`
  - `img-src 'self' data: blob: https:`
  - `style-src 'self' 'unsafe-inline'`
  - `script-src 'self'` (dev/prod farklari ayri degerlendirilecek)
- Ihlal raporlarini topla, 1 sprint sonra enforce moda gec.

## Faz 5: Kaldirma
- localStorage token yazan/okuyan tum kodu kaldir.
- Geriye donuk fallbackleri kapat.
- Güvenlik regression testlerini kalici CI asamasina ekle.

## Test Checklist
- Oturumlu editor acilis/kaydet/export/share akislari calisiyor.
- Logout sonrasi cookie temizleniyor ve editor API cagrilari 401 donuyor.
- XSS simulasyonunda token `document.cookie` ve `localStorage` uzerinden erisilemez.
- CSRF’siz `POST/PATCH` cagrilari engelleniyor.
