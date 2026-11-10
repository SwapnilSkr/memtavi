CREATE FUNCTION public.list_members(page_limit integer DEFAULT 50, page_offset integer DEFAULT 0)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  image text,
  role public.member_role,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT u.id, u.email::text, u.name, u.image, m.role, u.created_at
  FROM public.memberships AS m
  JOIN public.users AS u ON u.id = m.user_id
  WHERE m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  ORDER BY m.user_id
  LIMIT GREATEST(1, LEAST(COALESCE(page_limit, 50), 200))
  OFFSET GREATEST(COALESCE(page_offset, 0), 0)
$$;

REVOKE ALL ON FUNCTION public.list_members(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_members(integer, integer) TO memtavi_app;
