# Security Threat Model

## Kritik Varlıklar

- Tenant verileri (mail, matter, task, AI conversation)
- OAuth access/refresh tokenları
- Kullanıcı session tokenları
- Doküman ve attachment dosyaları
- Audit ve security event kayıtları

## Tehdit Aktörleri

- Dış saldırgan (credential stuffing, token theft)
- Kötü niyetli tenant içi kullanıcı (privilege escalation)
- Yanlış yapılandırılmış entegrasyon (webhook spoofing)
- Tedarik zinciri riski (paket bağımlılıkları)

## Saldırı Yüzeyleri

- Auth endpointleri
- OAuth callback / provider bağlantı akışları
- Mail webhook endpointleri
- Dosya upload/download URL akışları
- Admin ve audit görüntüleme ekranları

## Önlemler

- Tenant-aware query + row-level authorization
- Session token hash saklama
- Provider token encrypted saklama (TODO: KMS envelope encryption)
- RBAC zorunlu permission check
- Audit log zorunlu (auth, domain, mailbox, ai)
- Queue idempotency + retry + dead-letter tasarımı
- Signed URL ve MIME doğrulama (TODO: file gateway)
