import { NextResponse } from 'next/server';

type ValidateMatterScopeInput = {
  headers: Headers;
  payloadMatterId?: string | null;
  resourceMatterId?: string | null;
  route: string;
};

function clean(value: string | null | undefined): string | null {
  const token = (value ?? '').trim();
  return token.length > 0 ? token : null;
}

export function resolveRequestedMatterId(headers: Headers): string | null {
  return clean(headers.get('x-matter-id') ?? headers.get('x-case-id'));
}

export function validateMatterScope(input: ValidateMatterScopeInput): NextResponse | null {
  const requested = resolveRequestedMatterId(input.headers);
  const payloadMatterId = clean(input.payloadMatterId);
  const resourceMatterId = clean(input.resourceMatterId);

  if (requested && payloadMatterId && requested !== payloadMatterId) {
    console.warn(
      JSON.stringify({
        event: 'matter_scope_denied',
        route: input.route,
        reason: 'header_payload_mismatch',
        requested_matter_id: requested,
        payload_matter_id: payloadMatterId,
      }),
    );
    return NextResponse.json(
      {
        error: 'Matter kapsamı uyuşmuyor (header ve payload farklı).',
        error_code: 'MATTER_SCOPE_MISMATCH',
      },
      { status: 403 },
    );
  }

  if (requested && resourceMatterId && requested !== resourceMatterId) {
    console.warn(
      JSON.stringify({
        event: 'matter_scope_denied',
        route: input.route,
        reason: 'header_resource_mismatch',
        requested_matter_id: requested,
        resource_matter_id: resourceMatterId,
      }),
    );
    return NextResponse.json(
      {
        error: 'Matter kapsamı uyuşmuyor (erişilen kaynak farklı matter altında).',
        error_code: 'MATTER_SCOPE_MISMATCH',
      },
      { status: 403 },
    );
  }

  return null;
}
