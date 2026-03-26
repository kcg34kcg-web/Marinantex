import { ForbiddenException } from "@nestjs/common";

export interface MatterScopeInput {
  route: string;
  requestedMatterId?: string;
  payloadMatterId?: string;
  resourceMatterId?: string;
}

function normalize(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const token = value.trim();
  return token.length > 0 ? token : undefined;
}

export function requestedMatterFromHeaders(headers: Record<string, unknown>): string | undefined {
  const xMatterId = normalize(typeof headers["x-matter-id"] === "string" ? headers["x-matter-id"] : undefined);
  if (xMatterId) {
    return xMatterId;
  }
  return normalize(typeof headers["x-case-id"] === "string" ? headers["x-case-id"] : undefined);
}

export function assertMatterScope(input: MatterScopeInput): void {
  const requested = normalize(input.requestedMatterId);
  const payloadMatterId = normalize(input.payloadMatterId);
  const resourceMatterId = normalize(input.resourceMatterId);

  if (requested && payloadMatterId && requested !== payloadMatterId) {
    throw new ForbiddenException(
      JSON.stringify({
        error_code: "MATTER_SCOPE_MISMATCH",
        route: input.route,
        reason: "header_payload_mismatch",
      }),
    );
  }

  if (requested && resourceMatterId && requested !== resourceMatterId) {
    throw new ForbiddenException(
      JSON.stringify({
        error_code: "MATTER_SCOPE_MISMATCH",
        route: input.route,
        reason: "header_resource_mismatch",
      }),
    );
  }
}
