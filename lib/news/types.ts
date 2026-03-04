export type NewsCategory = 'Mevzuat' | 'Duyuru' | 'Ictihat' | 'Sektorel';
export type NewsSeverity = 'kritik' | 'orta' | 'bilgi';
export type WorkspaceTag = 'icra' | 'is' | 'kira' | 'ceza' | 'kvkk' | 'finans' | 'eticaret' | 'enerji';

export type ImpactedCase = {
  id: string;
  title: string;
  reason: string;
};

export type LiveNewsItem = {
  id: string;
  title: string;
  source: string;
  sourceUrl: string;
  publishedAt: string;
  updatedAt?: string;
  category: NewsCategory;
  severity: NewsSeverity;
  tags: string[];
  workspaces: WorkspaceTag[];
  summary: string;
  detailText: string;
  highlights: string[];
  impactCases: ImpactedCase[];
  actionDraft: string[];
  isWhitelistedSource: boolean;
};

export type NewsSourceHealth = {
  id: string;
  name: string;
  endpoint: string;
  transport: 'rss' | 'x-api';
  success: boolean;
  itemCount: number;
  latencyMs: number;
  error?: string;
};

export type DashboardNewsPayload = {
  generatedAt: string;
  followupKeywords: string[];
  items: LiveNewsItem[];
  sources: NewsSourceHealth[];
};

export type DashboardCaseLite = {
  id: string;
  title: string;
  fileNo: string | null;
  clientDisplayName: string | null;
  tags: string[];
  status: 'open' | 'in_progress' | 'closed' | 'archived';
};
