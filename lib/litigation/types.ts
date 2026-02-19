export type NliLabel = 'entailment' | 'neutral' | 'contradiction';

export interface TemporalFactNode {
  id: string;
  caseId: string;
  label: string;
  factualOccurrenceDate: string | null;
  epistemicDiscoveryDate: string | null;
  sourceDocumentId: string | null;
}

export interface ExtractedTriple {
  id: string;
  caseId: string;
  subject: string;
  predicate: string;
  object: string;
  confidenceScore: string;
  extractionModel: string;
  extractedAt: string;
}

export interface ContradictionCandidate {
  leftStatementId: string;
  rightStatementId: string;
  semanticSimilarity: string;
  nliLabel?: NliLabel;
  nliConfidence?: string;
}

export interface LimitationEvent {
  id: string;
  caseId: string;
  eventDate: string;
  eventType: 'start' | 'tolling_start' | 'tolling_end' | 'interruption';
  note: string;
}

export interface AdvisoryDateResult {
  estimatedDate: string;
  advisoryLabel: 'advisory_estimated';
  requiresUserAcceptance: true;
}
