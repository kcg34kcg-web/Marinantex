-- ============================================================================
-- V2.1 Step 3: Hukuki Kanonik Veri Modeli — Authority Migration
-- Adds detailed court authority fields and updates hybrid_legal_search to
-- use the full authority score formula:
--
--   authority_score = court_level_base * majority_multiplier − dissent_penalty
--
-- İBKB, HGK, CGK ve DANISTAY_IDDK kararları için "hard boost" uygulanır;
-- bu bağlayıcı içtihatlar, aynı semantik skora sahip diğer kararların
-- DAIMA önüne geçer (retrieval_binding_hard_boost = 0.20 by default).
--
-- Run order: schema.sql → rag.sql → rag_v2_step2_metadata.sql
--            → rag_v2_step3_authority.sql
-- Safe to re-run: all statements use IF NOT EXISTS / OR REPLACE.
-- ============================================================================

-- ─── 1. New Columns on `documents` ───────────────────────────────────────────

-- Mahkeme Dairesi / chamber
--   e.g. '9. Hukuk Dairesi', '2. Hukuk Dairesi', '4. İdare Dairesi'
--   NULL for legislative / regulatory documents.
alter table public.documents
  add column if not exists chamber text;

-- Oy türü / majority_type
--   Allowed values: 'OY_BIRLIGI' | 'OY_COKLUGU' | 'KARSI_OY'
--   NULL = unknown / not applicable (e.g. law articles)
alter table public.documents
  add column if not exists majority_type text;

-- Karşı oy var mı / dissent_present
--   TRUE = at least one dissenting opinion noted in the decision.
alter table public.documents
  add column if not exists dissent_present boolean not null default false;

-- Norm hiyerarşisi / norm_hierarchy
--   Allowed values: 'ANAYASA' | 'KANUN' | 'CBK' | 'YONETMELIK' | 'TEBLIG' | 'DIGER'
--   NULL for court decisions (they are not norms, they interpret norms).
alter table public.documents
  add column if not exists norm_hierarchy text;

-- ─── 2. Check Constraints ────────────────────────────────────────────────────

alter table public.documents
  drop constraint if exists chk_documents_majority_type;
alter table public.documents
  add constraint chk_documents_majority_type
  check (majority_type is null or majority_type in ('OY_BIRLIGI', 'OY_COKLUGU', 'KARSI_OY'));

alter table public.documents
  drop constraint if exists chk_documents_norm_hierarchy;
alter table public.documents
  add constraint chk_documents_norm_hierarchy
  check (norm_hierarchy is null or norm_hierarchy in ('ANAYASA', 'KANUN', 'CBK', 'YONETMELIK', 'TEBLIG', 'DIGER'));

-- ─── 3. Indexes ──────────────────────────────────────────────────────────────

create index if not exists idx_documents_majority_type
  on public.documents (majority_type)
  where majority_type is not null;

create index if not exists idx_documents_norm_hierarchy
  on public.documents (norm_hierarchy)
  where norm_hierarchy is not null;

-- Partial index: quickly find all binding-precedent documents
create index if not exists idx_documents_binding_precedent
  on public.documents (court_level)
  where court_level in ('AYM', 'YARGITAY_IBK', 'YARGITAY_HGK', 'YARGITAY_CGK', 'DANISTAY_IDDK');

-- ─── 4. Updated court_level_weight() ─────────────────────────────────────────
--
-- Adds AYM, YARGITAY_CGK, DANISTAY_IDDK which were missing in rag.sql.
-- Existing values for IBK, HGK, DAIRE, BAM remain unchanged so the
-- existing hierarchy_score distribution is stable.
--
create or replace function public.court_level_weight(level text)
returns double precision
language sql
immutable
as $$
  select case
    when level = 'AYM'             then 1.00   -- Anayasa Mahkemesi
    when level = 'YARGITAY_IBK'    then 1.00   -- İçtihadı Birleştirme — binding
    when level = 'YARGITAY_HGK'    then 0.95   -- Hukuk Genel Kurulu   — binding
    when level = 'YARGITAY_CGK'    then 0.95   -- Ceza Genel Kurulu    — binding
    when level = 'DANISTAY_IDDK'   then 0.88   -- İdari Dava Daireleri Kurulu
    when level = 'YARGITAY_DAIRE'  then 0.75   -- Standard Yargıtay daire
    when level = 'DANISTAY'        then 0.70   -- Danıştay daireleri
    when level = 'BAM'             then 0.50   -- Bölge Adliye Mahkemesi
    when level = 'ILKDERECE'       then 0.30   -- İlk derece mahkemeleri
    else                                0.40   -- unknown / DIGER
  end;
$$;

-- ─── 5. compute_authority_score() ────────────────────────────────────────────
--
-- Full authority formula that incorporates majority type and dissent:
--
--   authority = GREATEST(0.0, LEAST(1.0,
--     court_level_weight(court_level)
--     * majority_multiplier(majority_type)
--     - dissent_penalty(dissent_present)
--   ))
--
-- Multiplier map:
--   OY_BIRLIGI (unanimous)  → 1.00   (highest certainty)
--   OY_COKLUGU (majority)   → 0.92   (standard)
--   NULL / unknown           → 0.92   (default = majority)
--   KARSI_OY   (with dissent)→ 0.82   (doctrinal tension)
--
-- Dissent penalty: −0.04 when dissent_present = true
--   Applied independently of majority_type so KARSI_OY + dissent = 0.82*base − 0.04
--
create or replace function public.compute_authority_score(
  p_court_level    text,
  p_majority_type  text,
  p_dissent        boolean
)
returns double precision
language sql
immutable
as $$
  select greatest(0.0, least(1.0,
    public.court_level_weight(p_court_level)
    * case
        when p_majority_type = 'OY_BIRLIGI' then 1.00
        when p_majority_type = 'KARSI_OY'   then 0.82
        else                                     0.92   -- OY_COKLUGU or NULL
      end
    - case when coalesce(p_dissent, false) then 0.04 else 0.0 end
  ));
$$;

-- ─── 6. is_binding_precedent() helper ────────────────────────────────────────

create or replace function public.is_binding_precedent(level text)
returns boolean
language sql
immutable
as $$
  select level in ('AYM', 'YARGITAY_IBK', 'YARGITAY_HGK', 'YARGITAY_CGK', 'DANISTAY_IDDK');
$$;

-- ─── 7. Updated hybrid_legal_search() ────────────────────────────────────────
--
-- Changes from rag_v2_step2_metadata.sql version:
--   • hierarchy_score now uses compute_authority_score() (was court_level_weight())
--   • binding_boost column added: +0.20 for binding-precedent documents
--   • final_score includes binding_boost (capped at 1.0)
--   • New output columns: chamber, majority_type, dissent_present, norm_hierarchy
--
drop function if exists public.hybrid_legal_search(vector, text, uuid, integer);

create or replace function public.hybrid_legal_search(
  query_embedding  vector(1536),
  query_text       text,
  case_scope       uuid    default null,
  match_count      int     default 12
)
returns table (
  id               uuid,
  case_id          uuid,
  content          text,
  file_path        text,
  citation         text,
  court_level      text,
  ruling_date      date,
  -- Step 2: provenance
  source_url       text,
  version          text,
  collected_at     timestamptz,
  -- Step 3: authority model
  chamber          text,
  majority_type    text,
  dissent_present  boolean,
  norm_hierarchy   text,
  -- Scoring
  semantic_score   double precision,
  keyword_score    double precision,
  recency_score    double precision,
  hierarchy_score  double precision,
  binding_boost    double precision,
  final_score      double precision
)
language sql
stable
as $$
with candidates as (
  select
    d.id,
    d.case_id,
    d.content,
    d.file_path,
    d.citation,
    d.court_level,
    d.ruling_date,
    d.source_url,
    d.version,
    d.collected_at,
    d.chamber,
    d.majority_type,
    d.dissent_present,
    d.norm_hierarchy,
    -- Scoring components
    (1 - (d.embedding <=> query_embedding))                                     as semantic_score,
    ts_rank_cd(d.keywords_tsv, plainto_tsquery('simple', query_text))           as keyword_score,
    greatest(
      0.0,
      1 - ((now()::date - coalesce(d.ruling_date, now()::date))::double precision / 3650.0)
    )                                                                            as recency_score,
    -- Step 3: authority score replaces bare court_level_weight()
    public.compute_authority_score(d.court_level, d.majority_type, d.dissent_present) as hierarchy_score
  from public.documents d
  where d.embedding is not null
    and (case_scope is null or d.case_id = case_scope)
),
scored as (
  select
    c.*,
    -- Hard boost for binding precedents: +0.20, ensures they rank above
    -- ordinary appellate decisions regardless of semantic similarity.
    case when public.is_binding_precedent(c.court_level) then 0.20 else 0.0 end
      as binding_boost
  from candidates c
)
select
  s.id,
  s.case_id,
  s.content,
  s.file_path,
  s.citation,
  s.court_level,
  s.ruling_date,
  s.source_url,
  s.version,
  s.collected_at,
  s.chamber,
  s.majority_type,
  s.dissent_present,
  s.norm_hierarchy,
  s.semantic_score,
  s.keyword_score,
  s.recency_score,
  s.hierarchy_score,
  s.binding_boost,
  -- final_score: weighted sum + binding hard boost, capped at 1.0
  least(1.0,
    (0.45 * s.semantic_score)  +
    (0.30 * s.keyword_score)   +
    (0.10 * s.recency_score)   +
    (0.15 * s.hierarchy_score) +
    s.binding_boost
  ) as final_score
from scored s
order by final_score desc
limit match_count;
$$;

-- ─── 8. Updated get_must_cite_documents() ────────────────────────────────────
--
-- Surfaces new Step 3 columns so must-cite docs carry the same metadata.
--
drop function if exists public.get_must_cite_documents(uuid);

create or replace function public.get_must_cite_documents(
  p_case_id uuid
)
returns table (
  id               uuid,
  case_id          uuid,
  content          text,
  file_path        text,
  citation         text,
  court_level      text,
  ruling_date      date,
  source_url       text,
  version          text,
  collected_at     timestamptz,
  -- Step 3 authority fields
  chamber          text,
  majority_type    text,
  dissent_present  boolean,
  norm_hierarchy   text,
  -- Scoring
  semantic_score   double precision,
  keyword_score    double precision,
  recency_score    double precision,
  hierarchy_score  double precision,
  binding_boost    double precision,
  final_score      double precision,
  must_cite_score  double precision
)
language sql
stable
as $$
  select
    d.id,
    d.case_id,
    d.content,
    d.file_path,
    d.citation,
    d.court_level,
    d.ruling_date,
    d.source_url,
    d.version,
    d.collected_at,
    d.chamber,
    d.majority_type,
    d.dissent_present,
    d.norm_hierarchy,
    0.0                                                                                     as semantic_score,
    0.0                                                                                     as keyword_score,
    greatest(
      0.0,
      1 - ((now()::date - coalesce(d.ruling_date, now()::date))::double precision / 3650.0)
    )                                                                                       as recency_score,
    public.compute_authority_score(d.court_level, d.majority_type, d.dissent_present)      as hierarchy_score,
    case when public.is_binding_precedent(d.court_level) then 0.20 else 0.0 end            as binding_boost,
    mc.score                                                                                as final_score,
    mc.score                                                                                as must_cite_score
  from public.case_must_cites mc
  join public.documents d on d.id = mc.document_id
  where mc.case_id = p_case_id
    and d.embedding is not null
  order by mc.score desc;
$$;

-- ─── 9. Column Comments ──────────────────────────────────────────────────────

comment on column public.documents.chamber is
  'Specific court chamber / daire name.  '
  'e.g. "9. Hukuk Dairesi", "2. Ceza Dairesi".  '
  'NULL for legislative documents.';

comment on column public.documents.majority_type is
  'Voting outcome: OY_BIRLIGI (unanimous) | OY_COKLUGU (majority) | KARSI_OY (dissent noted).  '
  'NULL for non-decision documents.';

comment on column public.documents.dissent_present is
  'TRUE when the decision contains a formally noted dissenting opinion.  '
  'Triggers a −0.04 penalty in compute_authority_score().';

comment on column public.documents.norm_hierarchy is
  'Norm hierarchy tier for legislative documents: '
  'ANAYASA | KANUN | CBK | YONETMELIK | TEBLIG | DIGER.  '
  'NULL for court decisions (they interpret norms, not create them).';
