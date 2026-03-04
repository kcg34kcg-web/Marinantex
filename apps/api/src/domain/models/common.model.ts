export type Uuid = string;
export type IsoDateTime = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CanonicalDocumentTree {
  type: string;
  schemaVersion: number;
  content: JsonValue;
}
