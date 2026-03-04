export type UserRole = 'lawyer' | 'assistant' | 'client';

export type CaseStatus = 'open' | 'in_progress' | 'closed' | 'archived';

export enum ChatMode {
  GENERAL_CHAT = 'general_chat',
  DOCUMENT_ANALYSIS = 'document_analysis',
}

export enum ResponseType {
  LEGAL_GROUNDED = 'legal_grounded',
  SOCIAL_UNGROUNDED = 'social_ungrounded',
}

export enum AiTier {
  HAZIR_CEVAP = 'hazir_cevap',
  DUSUNCELI = 'dusunceli',
  UZMAN = 'uzman',
  MUAZZAM = 'muazzam',
}

export enum ResponseDepth {
  SHORT = 'short',
  STANDARD = 'standard',
  DETAILED = 'detailed',
}

export enum SaveMode {
  OUTPUT_ONLY = 'output_only',
  OUTPUT_WITH_THREAD = 'output_with_thread',
  OUTPUT_WITH_THREAD_AND_SOURCES = 'output_with_thread_and_sources',
}

export enum SaveTarget {
  MY_FILES = 'my_files',
  EXISTING_CASE = 'existing_case',
  NEW_CASE = 'new_case',
}

export enum ClientAction {
  NONE = 'none',
  TRANSLATE_FOR_CLIENT_DRAFT = 'translate_for_client_draft',
  SAVE_CLIENT_DRAFT = 'save_client_draft',
}

export interface TemporalFields {
  as_of_date?: string;
  event_date?: string;
  decision_date?: string;
}

export interface RagAnswerSentenceV3 {
  sentence_id: number;
  text: string;
  source_refs: number[];
  is_grounded: boolean;
}

export interface RagSourceV3 {
  id?: string;
  doc_id?: string;
  title?: string;
  content: string;
  source_type?: string;
  source_origin?: string;
  source_anchor?: string;
  page_no?: number;
  char_start?: number;
  char_end?: number;
  final_score?: number;
  recency_score?: number;
  support_span?: number;
  citation_confidence?: number;
  quality_source_class?: string;
  authority_score?: number;
  document_type?: string;
  version_type?: string;
}

export interface CitationQualityV3 {
  source_strength: 'Yuksek' | 'Orta' | 'Dusuk' | string;
  source_count: number;
  source_type_distribution: Record<string, number>;
  recency_label?: 'Guncel' | 'Karisik' | 'Arsiv' | 'Bilinmiyor' | string;
  average_support_span?: number;
  average_citation_confidence?: number;
}

export interface RagQueryRequestV3 {
  query: string;
  thread_id?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  case_id?: string;
  chat_mode: ChatMode;
  ai_tier: AiTier;
  response_depth: ResponseDepth;
  strict_grounding?: boolean;
  as_of_date?: string;
  event_date?: string;
  decision_date?: string;
  active_document_ids?: string[];
  save_mode?: SaveMode;
  client_action?: ClientAction;
  max_sources?: number;
}

export interface RagResponseV3 {
  response_type: ResponseType;
  answer: string;
  answer_sentences: RagAnswerSentenceV3[];
  sources: RagSourceV3[];
  tier_used: number;
  model_used: string;
  grounding_ratio: number;
  citation_quality_summary: string;
  citation_quality?: CitationQualityV3;
  estimated_cost: number;
  audit_trail_id: string;
  temporal_fields?: TemporalFields;
}

export interface RagCitationSnapshotItemV3 {
  source_id?: string;
  source_type?: string;
  source_anchor?: string;
  page_no?: number;
  char_start?: number;
  char_end?: number;
  source_hash?: string;
  doc_version?: string;
  citation_text?: string;
  metadata?: Record<string, unknown>;
}

export interface RagSaveRequestV3 {
  answer: string;
  response_type?: ResponseType;
  title?: string;
  output_type?: string;
  output_kind?: string;
  save_mode?: SaveMode;
  save_target?: SaveTarget;
  thread_id?: string;
  source_message_id?: string;
  saved_from_message_id?: string;
  parent_output_id?: string;
  is_final?: boolean;
  case_id?: string;
  new_case_title?: string;
  metadata?: Record<string, unknown>;
  citations?: RagCitationSnapshotItemV3[];
  client_action?: ClientAction;
  client_id?: string;
  client_draft_text?: string;
  client_draft_title?: string;
  client_metadata?: Record<string, unknown>;
}

export interface RagSaveResponseV3 {
  success: boolean;
  saved_output_id: string;
  case_id?: string | null;
  case_created?: boolean;
  citation_count?: number;
  client_message_id?: string | null;
  client_draft_preview?: string | null;
}

export interface RagFeatureFlagsV1 {
  strict_grounding_v2: boolean;
  tier_selector_ui: boolean;
  router_hybrid_v3: boolean;
  save_targets_v2: boolean;
  client_translator_draft: boolean;
  memory_dashboard_v1: boolean;
}

export interface RagMemoryFactV1 {
  id: string;
  fact_text: string;
  confidence: number;
  source_type: string;
  created_at: string;
  updated_at?: string;
}

export interface RagMemoryPreferenceV1 {
  id: string;
  pref_key: string;
  pref_value: string;
  created_at: string;
  updated_at: string;
}

export interface RagMemoryEdgeV1 {
  id: string;
  from_fact_id: string;
  to_fact_id: string;
  relation_type: string;
  weight: number;
  created_at: string;
}

export interface RagMemoryResponseV1 {
  feature_enabled: boolean;
  memory_writeback_enabled: boolean;
  facts: RagMemoryFactV1[];
  preferences: RagMemoryPreferenceV1[];
  edges: RagMemoryEdgeV1[];
}

export interface Profile {
  id: string;
  fullName: string;
  role: UserRole;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Case {
  id: string;
  title: string;
  status: CaseStatus;
  lawyerId: string;
  clientId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  id: string;
  caseId: string;
  content: string;
  embedding: number[] | null;
  filePath: string;
  createdAt: string;
}

export interface CaseUpdate {
  id: string;
  caseId: string;
  message: string;
  date: string;
  isPublicToClient: boolean;
  createdBy: string;
  createdAt: string;
}

export interface AiChat {
  id: string;
  userId: string;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface ActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export * from './finance';
