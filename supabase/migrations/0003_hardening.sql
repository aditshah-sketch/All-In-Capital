-- Pin search_path on every helper (Supabase advisor 0011) and keep pg_net
-- out of the public schema (advisor 0014). net.http_post stays in schema net.
alter function public.spend_today_usd() set search_path = public;
alter function public.claim_thread(uuid, text, int) set search_path = public;
alter function public.release_thread(uuid, text) set search_path = public;
alter function public.match_knowledge(extensions.vector, int, text) set search_path = public, extensions;
alter function public.match_portfolio(extensions.vector, int) set search_path = public, extensions;
alter function public.match_corrections(extensions.vector, int) set search_path = public, extensions;
alter function public.match_style_examples(extensions.vector, int) set search_path = public, extensions;

do $$
begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
             where e.extname = 'pg_net' and n.nspname = 'public') then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end $$;
