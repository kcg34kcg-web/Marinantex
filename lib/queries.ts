import { createClient } from '@/utils/supabase/client';
import type { CaseStatus } from '@/types';

interface CaseRowLite {
  id: string;
  title: string;
  status: CaseStatus;
}

interface CaseUpdateRowLite {
  id: string;
  case_id: string;
  date: string;
}

interface PortalCaseRowLite {
  id: string;
  title: string;
  status: CaseStatus;
  updated_at: string;
}

interface DashboardCaseRowLite {
  id: string;
  title: string;
  status: CaseStatus;
  updated_at: string;
  client: { full_name: string | null } | Array<{ full_name: string | null }> | null;
}

interface CaseNoteDateRowLite {
  case_id: string;
  created_at: string;
}

interface CaseTaskDateRowLite {
  case_id: string | null;
  created_at: string;
}

export interface DashboardDeadlineItem {
  id: string;
  title: string;
  date: string;
}

export interface DashboardData {
  briefingText: string;
  deadlines: DashboardDeadlineItem[];
}

export interface PortalCaseItem {
  id: string;
  title: string;
  status: CaseStatus;
  updatedAt: string;
}

export interface PortalAnnouncementItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface DashboardCaseItem {
  id: string;
  title: string;
  clientName: string;
  status: CaseStatus;
  updatedAt: string;
  lastNoteAt: string | null;
  lastTaskAt: string | null;
}

export interface DashboardCaseStats {
  total: number;
  open: number;
  inProgress: number;
  closed: number;
  archived: number;
}

export interface DashboardCasesQueryParams {
  query?: string;
  statusFilter?: 'all' | CaseStatus;
  quickView?: 'all' | 'open' | 'active' | 'updated_this_week' | 'high_risk';
  sortBy?: 'updated_desc' | 'updated_asc' | 'title_asc';
  page?: number;
  pageSize?: number;
}

export interface DashboardCasesResult {
  items: DashboardCaseItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  stats: DashboardCaseStats;
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const supabase = createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('Kullanıcı oturumu doğrulanamadı.');
  }

  const [casesResult, updatesResult] = await Promise.all([
    supabase.from('cases').select('id, title, status').order('updated_at', { ascending: false }).limit(20),
    supabase
      .from('case_updates')
      .select('id, case_id, date')
      .gte('date', new Date().toISOString())
      .order('date', { ascending: true })
      .limit(3),
  ]);

  if (casesResult.error) {
    throw new Error('Dosya verileri alınamadı.');
  }

  if (updatesResult.error) {
    throw new Error('Takvim verileri alınamadı.');
  }

  const caseList = (casesResult.data as CaseRowLite[] | null) ?? [];
  const updateList = (updatesResult.data as CaseUpdateRowLite[] | null) ?? [];

  const statusCount = {
    open: caseList.filter((item) => item.status === 'open').length,
    inProgress: caseList.filter((item) => item.status === 'in_progress').length,
    closed: caseList.filter((item) => item.status === 'closed').length,
  };

  const deadlines = updateList
    .map((item) => {
      const relatedCase = caseList.find((caseItem) => caseItem.id === item.case_id);
      return {
        id: item.id,
        title: relatedCase?.title ?? 'Dosya güncellemesi',
        date: item.date,
      };
    })
    .filter((item) => Boolean(item.date));

  return {
    briefingText:
      caseList.length === 0
        ? 'Henüz aktif dosya görünmüyor. Yeni dosya ekleyerek güne başlayabilirsiniz.'
        : `Toplam ${caseList.length} dosya var. Açık: ${statusCount.open}, süreçte: ${statusCount.inProgress}, kapalı: ${statusCount.closed}.`,
    deadlines,
  };
}

export async function fetchPortalCases(): Promise<PortalCaseItem[]> {
  const supabase = createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('Kullanıcı oturumu doğrulanamadı.');
  }

  const { data, error } = await supabase
    .from('cases')
    .select('id, title, status, updated_at')
    .eq('client_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error('Paylaşılan dosyalar alınamadı.');
  }

  const rows = (data as PortalCaseRowLite[] | null) ?? [];

  return rows.map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    updatedAt: item.updated_at,
  }));
}

export async function fetchPortalAnnouncements(): Promise<PortalAnnouncementItem[]> {
  const supabase = createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('Kullanıcı oturumu doğrulanamadı.');
  }

  const { data, error } = await supabase
    .from('portal_announcements')
    .select('id, title, body, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(3);

  if (error) {
    throw new Error('Portal duyuruları alınamadı.');
  }

  const rows = (data as Array<{ id: string; title: string; body: string; created_at: string }> | null) ?? [];
  return rows.map((item) => ({
    id: item.id,
    title: item.title,
    body: item.body,
    createdAt: item.created_at,
  }));
}

export async function fetchDashboardCases(params: DashboardCasesQueryParams = {}): Promise<DashboardCasesResult> {
  const searchParams = new URLSearchParams();

  searchParams.set('page', String(params.page ?? 1));
  searchParams.set('pageSize', String(params.pageSize ?? 20));
  searchParams.set('status', params.statusFilter ?? 'all');
  searchParams.set('quickView', params.quickView ?? 'all');
  searchParams.set('sortBy', params.sortBy ?? 'updated_desc');

  if (params.query?.trim()) {
    searchParams.set('q', params.query.trim());
  }

  const response = await fetch(`/api/dashboard/cases/list?${searchParams.toString()}`, {
    cache: 'no-store',
  });

  const responseText = await response.text();
  let payload: DashboardCasesResult & { error?: string };

  if (!responseText) {
    payload = { error: 'Sunucudan boş yanıt alındı.' } as DashboardCasesResult & { error?: string };
  } else {
    try {
      payload = JSON.parse(responseText) as DashboardCasesResult & { error?: string };
    } catch {
      payload = { error: 'Sunucudan beklenmeyen yanıt alındı.' } as DashboardCasesResult & { error?: string };
    }
  }

  if (!response.ok) {
    throw new Error(payload.error ?? 'Dosya listesi alınamadı.');
  }

  return {
    items: payload.items ?? [],
    pagination: payload.pagination ?? { page: 1, pageSize: 20, total: 0, totalPages: 1 },
    stats: payload.stats ?? { total: 0, open: 0, inProgress: 0, closed: 0, archived: 0 },
  };
}
