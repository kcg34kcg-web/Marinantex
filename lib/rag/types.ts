export interface HybridSearchResult {
  id: string;
  case_id: string;
  content: string;
  file_path: string;
  citation: string | null;
  court_level: string | null;
  ruling_date: string | null;
  semantic_score: number;
  keyword_score: number;
  recency_score: number;
  hierarchy_score: number;
  final_score: number;
}

export interface MustCiteCandidate {
  documentId: string;
  score: number;
}
