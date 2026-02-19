# E2EE Sync Outline

## Goals
- Zero-trust collaboration across multi-user litigation teams.
- Server stores ciphertext only.

## Cryptography
- Symmetric payload encryption: AES-256-GCM
- Key exchange: X3DH/Signal-style pre-key bundle (planned)
- Rotation: per-device and per-case key schedule

## Envelope
- ciphertext
- nonce
- auth_tag
- sender_device_id
- recipient_key_id
- signature

## Validation
- Signature check before decrypt.
- Replay protection via monotonic sequence + nonce cache.

## Migration Plan
1. Add encrypted payload tables.
2. Roll out read-path decrypt support.
3. Roll out write-path encrypt support.
4. Disable plaintext writes.
