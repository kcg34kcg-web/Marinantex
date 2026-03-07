# Secret / Env Checklist

- [ ] `AUTH_SECRET` 64+ char random
- [ ] `ENCRYPTION_MASTER_KEY` rotation planı tanımlı
- [ ] Provider client secret'lar secret manager üzerinden geliyor
- [ ] `.env` dosyaları repoya commit edilmiyor
- [ ] `DATABASE_URL` production TLS zorunlu
- [ ] `REDIS_URL` ACL ve auth açık
- [ ] S3 access key least privilege
