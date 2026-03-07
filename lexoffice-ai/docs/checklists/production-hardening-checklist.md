# Production Hardening Checklist

- [ ] HTTPS zorunlu + HSTS
- [ ] Rate limiting (auth, ai, sync trigger)
- [ ] CSP/CSRF policy aktif
- [ ] Session cookie `httpOnly`, `secure`, `sameSite=lax`
- [ ] Audit log immutable sink (WORM/SIEM) entegrasyonu
- [ ] Backup + restore tatbikatı
- [ ] DR hedefleri (RPO/RTO) dokümante
- [ ] Queue DLQ izleme paneli
