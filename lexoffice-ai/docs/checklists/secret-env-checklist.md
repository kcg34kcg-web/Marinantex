# Secret / Env Checklist

- [ ] `AUTH_SECRET` 64+ char random
- [ ] `ENCRYPTION_MASTER_KEY` rotation planı tanımlı
- [ ] Provider client secret'lar secret manager üzerinden geliyor
- [ ] `.env` dosyaları repoya commit edilmiyor
- [ ] `DATABASE_URL` production TLS zorunlu
- [ ] `REDIS_URL` ACL ve auth açık
- [ ] S3 access key least privilege
- [ ] `TOKEN_ENCRYPTION_KEY` ve provider refresh token key'leri ayrı tutuluyor
- [ ] Secret erişimleri service account bazlı least-privilege IAM ile sınırlandı
- [ ] Secret read erişimleri audit loglanıyor
- [ ] Key rotation sonrası eski key ile decrypt fallback penceresi tanımlı
- [ ] Secret değişiminde rollout/runbook (restart/order) dokümante
- [ ] CI/CD ortamında maskeli secret leak kontrolü etkin
- [ ] `APP_URL`, cookie domain ve redirect URI değerleri environment bazında doğrulandı
- [ ] Production env dosyalarında debug/dev flag'ler kapalı (`MAIL_SYNC_MOCK=false` vb.)
- [ ] LLM provider key'leri tenant policy ve budget guardrail ile birlikte kullanılıyor
