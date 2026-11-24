-- The 5-minute trigger: pg_cron + pg_net call /api/cron/queue.
-- The Bearer token is generated INSIDE the database and kept in Supabase Vault.
-- It never appears in code, git or a chat.
--
-- After applying, run once (with your deployed URL):
--   select setup_queue_cron('https://<your-app>.vercel.app');

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault;

-- Only the service role can check a token; the app calls this via RPC.
create function check_cron_token(token text) returns boolean
language sql stable security definer set search_path = public, vault as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'aic_cron_token' and decrypted_secret = token
  );
$$;
revoke all on function check_cron_token(text) from public, anon, authenticated;
grant execute on function check_cron_token(text) to service_role;

create function setup_queue_cron(app_url text) returns text
language plpgsql security definer set search_path = public, vault, cron as $$
declare
  existing uuid;
begin
  -- Token: created here, stored in Vault, never returned.
  select id into existing from vault.secrets where name = 'aic_cron_token';
  if existing is null then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'aic_cron_token');
  end if;

  select id into existing from vault.secrets where name = 'aic_app_url';
  if existing is null then
    perform vault.create_secret(app_url, 'aic_app_url');
  else
    perform vault.update_secret(existing, app_url);
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'aic-queue';
  perform cron.schedule('aic-queue', '*/5 * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'aic_app_url') || '/api/cron/queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'aic_cron_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    );
  $job$);
  return 'scheduled every 5 minutes';
end $$;
revoke all on function setup_queue_cron(text) from public, anon, authenticated;
grant execute on function setup_queue_cron(text) to service_role;

-- Expire cached model responses (logs are a second copy of founder data).
select cron.schedule('aic-cache-expiry', '15 3 * * *',
  $$ delete from public.llm_cache where expires_at < now() $$);
