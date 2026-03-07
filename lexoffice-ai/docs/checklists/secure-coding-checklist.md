# Secure Coding Checklist

- [ ] Her endpointte tenant access assertion var mı?
- [ ] Her kritik endpoint RBAC kontrolü yapıyor mu?
- [ ] Input validation Zod ile sağlandı mı?
- [ ] SQL injection riski için ham query yerine Prisma kullanılıyor mu?
- [ ] XSS için user-generated HTML sanitize ediliyor mu? (TODO)
- [ ] Dosya upload MIME/content sniffing uygulanıyor mu? (TODO)
- [ ] SSRF riskli URL fetch akışlarında allowlist var mı? (TODO)
- [ ] Açık redirect engelleri mevcut mu?
- [ ] Hata mesajlarında hassas bilgi sızmıyor mu?
