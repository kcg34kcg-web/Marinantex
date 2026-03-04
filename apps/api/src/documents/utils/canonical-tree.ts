import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export interface CanonicalTreeInput {
  type: string;
  schemaVersion: number;
  content: unknown;
}

export interface CanonicalTree {
  type: string;
  schemaVersion: number;
  content: Record<string, unknown>;
}

export function ensureCanonicalTree(
  input: CanonicalTreeInput | undefined,
  fallbackSchemaVersion = 1,
): CanonicalTree {
  if (!input) {
    return {
      type: "doc",
      schemaVersion: fallbackSchemaVersion,
      content: { blocks: [] },
    };
  }

  if (!input.type || typeof input.type !== "string") {
    throw new BadRequestException("canonicalJson.type must be a non-empty string");
  }

  if (
    typeof input.schemaVersion !== "number" ||
    !Number.isInteger(input.schemaVersion) ||
    input.schemaVersion < 1
  ) {
    throw new BadRequestException(
      "canonicalJson.schemaVersion must be an integer >= 1",
    );
  }

  if (
    input.content === null ||
    typeof input.content !== "object" ||
    Array.isArray(input.content)
  ) {
    throw new BadRequestException("canonicalJson.content must be an object");
  }

  return {
    type: input.type,
    schemaVersion: input.schemaVersion,
    content: input.content as Record<string, unknown>,
  };
}

export function toPrismaJsonValue(tree: CanonicalTree): Prisma.InputJsonValue {
  return tree as unknown as Prisma.InputJsonValue;
}
