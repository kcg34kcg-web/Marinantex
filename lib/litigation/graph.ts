import { z } from 'zod';

export const graphRelationSchema = z.enum(['contradiction', 'entailment', 'neutral']);
export type GraphRelation = z.infer<typeof graphRelationSchema>;

export const graphNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  factualOccurrenceDate: z.string().nullable(),
  epistemicDiscoveryDate: z.string().nullable(),
  x: z.number(),
  y: z.number(),
});

export const graphLinkSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  relation: graphRelationSchema,
  weight: z.number(),
});

export const graphPayloadSchema = z.object({
  nodes: z.array(graphNodeSchema),
  links: z.array(graphLinkSchema),
  meta: z
    .object({
      totalCandidates: z.number().int().nonnegative(),
      returnedLinks: z.number().int().nonnegative(),
      minSimilarity: z.number().min(0).max(1),
      maxEdges: z.number().int().positive(),
    })
    .optional(),
});

export const graphNeighborhoodPayloadSchema = z.object({
  centerNodeId: z.string().min(1),
  nodes: z.array(graphNodeSchema),
  links: z.array(graphLinkSchema),
});

export const bundleExportManifestSchema = z.object({
  caseId: z.string().min(1),
  finalBundleSha256: z.string().min(1),
  merkleRoot: z.string().min(1),
  chainHash: z.string().min(1),
  previousHash: z.string().nullable(),
  createdAt: z.string().min(1),
  nodeCount: z.number().int().nonnegative(),
  linkCount: z.number().int().nonnegative(),
  batesCount: z.number().int().nonnegative(),
});

export type GraphPayload = z.infer<typeof graphPayloadSchema>;
export type GraphNeighborhoodPayload = z.infer<typeof graphNeighborhoodPayloadSchema>;
export type BundleExportManifest = z.infer<typeof bundleExportManifestSchema>;

export function normalizeGraphRelation(value: string | null | undefined): GraphRelation {
  if (value === 'contradiction' || value === 'entailment' || value === 'neutral') {
    return value;
  }

  return 'neutral';
}
