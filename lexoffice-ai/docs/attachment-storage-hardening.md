# Attachment S3 Hardening

Bu doküman `ATTACHMENT_S3_QUARANTINE_BUCKET` ve `ATTACHMENT_S3_CLEAN_BUCKET` için önerilen minimum güvenlik politikasını verir.

## Bucket Ayrımı

- `quarantine` bucket:
  - Sadece upload + scan işlemleri.
  - Public erişim kapalı.
  - Lifecycle ile temizlenmeyen dosyalar (ör. 7 gün) silinir.
- `clean` bucket:
  - Sadece scan sonucu `CLEAN` dosyalar.
  - Public erişim kapalı.
  - Download sadece kısa TTL pre-signed URL ile.

## Örnek Policy (Quarantine)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyPublicRead",
      "Effect": "Deny",
      "Principal": "*",
      "Action": ["s3:GetObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::lexoffice-attachments-quarantine",
        "arn:aws:s3:::lexoffice-attachments-quarantine/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

## Örnek Policy (Clean)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RequireTLS",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::lexoffice-attachments-clean",
        "arn:aws:s3:::lexoffice-attachments-clean/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

## Operasyon Notları

- Uygulama IAM rolüne sadece gerekli aksiyonları verin: `GetObject`, `PutObject`, `DeleteObject`, `CopyObject`, `HeadObject`.
- `ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION=aws:kms` ve `ATTACHMENT_S3_KMS_KEY_ID` önerilir.
- Pre-signed URL TTL:
  - Upload: 15 dakika
  - Download: 5 dakika
- ClamAV veya SaaS scanner down durumunda attachment indirmeyi açmayın (`virusScanStatus != CLEAN`).
