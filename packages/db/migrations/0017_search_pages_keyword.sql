CREATE FUNCTION public.search_pages_keyword(brain text, query text, page_limit integer DEFAULT 20)
RETURNS TABLE (
  "pageId" text,
  slug text,
  title text,
  summary text,
  "pageType" text,
  rank real,
  "updatedAt" timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p.id, p.slug, p.title, p.summary, p.page_type::text,
    ts_rank(p.search_tsv, websearch_to_tsquery('english', query)) AS rank,
    COALESCE(p.last_compiled_at, p.last_referenced_at, to_timestamp(0))
  FROM public.pages AS p
  WHERE p.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND (NULLIF(current_setting('app.subject_id', true), '') IS NULL
      OR p.subject_id = NULLIF(current_setting('app.subject_id', true), '')::uuid)
    AND p.brain_id = brain
    AND p.deletion_state = 'active'
    AND p.search_tsv @@ websearch_to_tsquery('english', query)
  ORDER BY rank DESC, p.slug, p.id
  LIMIT GREATEST(1, LEAST(COALESCE(page_limit, 20), 200))
$$;

REVOKE ALL ON FUNCTION public.search_pages_keyword(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_pages_keyword(text, text, integer) TO memtavi_app;
