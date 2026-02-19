import { createHash } from 'node:crypto';
import { computeChainHash } from '@/lib/litigation/merkle';
import { encryptedEnvelopeSchema, ingestResponseSchema } from '@/lib/litigation/ingest';
import { createClient } from '@/utils/supabase/server';

interface PreviousChainRow {
  chain_hash: string;
}

interface SequenceRow {
  payload_hash: string;
  merkle_root: string | null;
}

const MAX_ENVELOPE_BYTES = 1_500_000;
const MAX_PAST_SKEW_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function estimateEnvelopeSize(envelope: {
  ciphertext: string;
  nonce: string;
  authTag: string;
  signature: string;
  senderDeviceId: string;
  recipientKeyId: string;
}): number {
  return Buffer.byteLength(
    `${envelope.ciphertext}${envelope.nonce}${envelope.authTag}${envelope.signature}${envelope.senderDeviceId}${envelope.recipientKeyId}`,
    'utf8',
  );
}

export async function POST(req: Request) {
  try {
    const parsed = encryptedEnvelopeSchema.safeParse(await req.json());

    if (!parsed.success) {
      return new Response('Geçersiz ingest zarfı.', { status: 400 });
    }

    const envelope = parsed.data;
    const supabase = await createClient();

    const sentAtMs = Date.parse(envelope.sentAt);
    const now = Date.now();

    if (!Number.isFinite(sentAtMs)) {
      return new Response('Geçersiz zaman damgası.', { status: 400 });
    }

    if (now - sentAtMs > MAX_PAST_SKEW_MS || sentAtMs - now > MAX_FUTURE_SKEW_MS) {
      return new Response('İstek zaman damgası geçersiz pencere dışında.', { status: 400 });
    }

    if (estimateEnvelopeSize(envelope) > MAX_ENVELOPE_BYTES) {
      return new Response('İçe aktarma zarfı boyutu limitin üzerinde.', { status: 413 });
    }

    const payloadHash = sha256(
      JSON.stringify({
        caseId: envelope.caseId,
        ciphertext: envelope.ciphertext,
        nonce: envelope.nonce,
        authTag: envelope.authTag,
        senderDeviceId: envelope.senderDeviceId,
        recipientKeyId: envelope.recipientKeyId,
        signature: envelope.signature,
        sequence: envelope.sequence,
        sentAt: envelope.sentAt,
      }),
    );

    const sequenceDigest = sha256(`${envelope.caseId}|${envelope.senderDeviceId}|${envelope.sequence}`);
    const nonceDigest = sha256(`${envelope.caseId}|${envelope.senderDeviceId}|${envelope.nonce}`);

    const { data: duplicate, error: duplicateError } = await supabase
      .from('evidence_chain_logs')
      .select('id')
      .eq('case_id', envelope.caseId)
      .eq('stage', 'ocr')
      .eq('payload_hash', payloadHash)
      .limit(1)
      .maybeSingle();

    if (duplicateError) {
      return new Response('İçe aktarma kontrolü başarısız.', { status: 500 });
    }

    if (duplicate) {
      return new Response('Aynı payload daha önce işlendi.', { status: 409 });
    }

    const { data: duplicateSequence, error: duplicateSequenceError } = await supabase
      .from('evidence_chain_logs')
      .select('payload_hash')
      .eq('case_id', envelope.caseId)
      .eq('stage', 'ocr_sequence')
      .eq('payload_hash', sequenceDigest)
      .limit(1)
      .maybeSingle();

    if (duplicateSequenceError) {
      return new Response('Replay kontrolü başarısız.', { status: 500 });
    }

    if (duplicateSequence) {
      return new Response('Tekrar eden sequence tespit edildi.', { status: 409 });
    }

    const { data: duplicateNonce, error: duplicateNonceError } = await supabase
      .from('evidence_chain_logs')
      .select('payload_hash')
      .eq('case_id', envelope.caseId)
      .eq('stage', 'ocr_nonce')
      .eq('payload_hash', nonceDigest)
      .limit(1)
      .maybeSingle();

    if (duplicateNonceError) {
      return new Response('Nonce replay kontrolü başarısız.', { status: 500 });
    }

    if (duplicateNonce) {
      return new Response('Tekrar eden nonce tespit edildi.', { status: 409 });
    }

    const { data: latestSequenceData, error: latestSequenceError } = await supabase
      .from('evidence_chain_logs')
      .select('payload_hash, merkle_root')
      .eq('case_id', envelope.caseId)
      .eq('stage', 'ocr_sequence')
      .like('merkle_root', `${envelope.senderDeviceId}:%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestSequenceError) {
      return new Response('Sequence sıralaması doğrulanamadı.', { status: 500 });
    }

    const latestSequenceRow = latestSequenceData as SequenceRow | null;
    const latestMarker = latestSequenceRow?.merkle_root ?? null;
    const latestSequence = latestMarker ? Number(latestMarker.split(':').at(1) ?? NaN) : null;

    if (latestSequence !== null && Number.isFinite(latestSequence) && envelope.sequence <= latestSequence) {
      return new Response('Sequence değeri artan sırada olmalıdır.', { status: 409 });
    }

    const { data: previousData, error: previousError } = await supabase
      .from('evidence_chain_logs')
      .select('chain_hash')
      .eq('case_id', envelope.caseId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (previousError) {
      return new Response('Önceki chain kaydı alınamadı.', { status: 500 });
    }

    const previousHash = ((previousData as PreviousChainRow | null)?.chain_hash ?? null) as string | null;
    const receivedAt = new Date().toISOString();
    const chainHash = computeChainHash({
      caseId: envelope.caseId,
      stage: 'ocr',
      payloadHash,
      previousHash,
      timestampIso: receivedAt,
    });

    const { error: insertError } = await supabase.from('evidence_chain_logs').insert({
      case_id: envelope.caseId,
      stage: 'ocr',
      payload_hash: payloadHash,
      previous_hash: previousHash,
      chain_hash: chainHash,
      merkle_root: null,
    });

    if (insertError) {
      return new Response('İçe aktarma chain kaydı yazılamadı.', { status: 500 });
    }

    const { error: sequenceInsertError } = await supabase.from('evidence_chain_logs').insert({
      case_id: envelope.caseId,
      stage: 'ocr_sequence',
      payload_hash: sequenceDigest,
      previous_hash: chainHash,
      chain_hash: sha256(`${chainHash}|${sequenceDigest}`),
      merkle_root: `${envelope.senderDeviceId}:${envelope.sequence}`,
    });

    if (sequenceInsertError) {
      return new Response('Sequence replay kaydı yazılamadı.', { status: 500 });
    }

    const { error: nonceInsertError } = await supabase.from('evidence_chain_logs').insert({
      case_id: envelope.caseId,
      stage: 'ocr_nonce',
      payload_hash: nonceDigest,
      previous_hash: chainHash,
      chain_hash: sha256(`${chainHash}|${nonceDigest}`),
      merkle_root: `${envelope.senderDeviceId}:${envelope.sentAt}`,
    });

    if (nonceInsertError) {
      return new Response('Nonce replay kaydı yazılamadı.', { status: 500 });
    }

    const response = ingestResponseSchema.parse({
      accepted: true,
      caseId: envelope.caseId,
      stage: 'ocr',
      payloadHash,
      chainHash,
      previousHash,
      receivedAt,
    });

    return Response.json(response);
  } catch {
    return new Response('İçe aktarma servisi geçici olarak kullanılamıyor.', { status: 500 });
  }
}
