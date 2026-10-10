-- Admin access is assigned by an operator, never by browser/user metadata.
create table public.app_admins (user_id uuid primary key references auth.users on delete cascade);
create table public.account_controls (
  user_id uuid primary key references auth.users on delete cascade,
  suspended boolean not null default false
);
create table public.admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users,
  target_id uuid not null references auth.users,
  action text not null check (action in ('suspend','restore')),
  created_at timestamptz not null default now()
);
create table public.api_model_rates (
  provider text not null, model text not null,
  input_usd_per_million numeric not null check(input_usd_per_million >= 0),
  output_usd_per_million numeric not null check(output_usd_per_million >= 0),
  unit_usd numeric not null default 0 check(unit_usd >= 0),
  source_url text not null, verified_at timestamptz not null,
  valid_until timestamptz,
  primary key(provider, model)
);
-- Standard paid-tier estimate; intro pricing must not silently continue into 2027.
insert into public.api_model_rates(provider,model,input_usd_per_million,output_usd_per_million,source_url,verified_at,valid_until)
values('gemini','gemini-3.8-flash',0.75,3.75,'https://ai.google.dev/gemini-api/docs/pricing','2026-10-10T00:00:00Z','2027-01-01T00:00:00Z');
create table public.api_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  request_id uuid not null, provider text not null, model text not null,
  outcome text not null check(outcome in ('success','error')),
  input_tokens bigint, output_tokens bigint, units integer not null default 0,
  estimated_usd numeric, pricing_source text,
  created_at timestamptz not null default now(),
  unique(request_id,provider),
  check(input_tokens >= 0 and output_tokens >= 0 and units >= 0)
);
create index api_usage_user_date on public.api_usage(user_id,created_at desc);
create index admin_audit_date on public.admin_audit(created_at desc);
do $$ declare t text; begin
  foreach t in array array['app_admins','account_controls','admin_audit','api_model_rates','api_usage'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create function public.account_is_active() returns boolean language sql stable security definer
set search_path = '' as $$
  select auth.uid() is not null and not exists
  (select 1 from public.account_controls where user_id=auth.uid() and suspended);
$$;
revoke all on function public.account_is_active() from public,anon;
grant execute on function public.account_is_active() to authenticated;
create policy active_account_workplaces on public.workplaces as restrictive for all to authenticated
  using (public.account_is_active()) with check(public.account_is_active());
create policy active_account_entries on public.entries as restrictive for all to authenticated
  using (public.account_is_active()) with check(public.account_is_active());

create function public.admin_users(p_search text, p_page integer, p_since timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  with matched as (
    select u.id,u.email,u.created_at,u.last_sign_in_at,u.email_confirmed_at,
      coalesce(c.suspended,false) suspended,
      exists(select 1 from public.app_admins a where a.user_id=u.id) is_admin
    from auth.users u left join public.account_controls c on c.user_id=u.id
    where u.email ilike '%' || left(coalesce(p_search,''),200) || '%'
  ), page as (select * from matched order by created_at desc,id limit 25 offset greatest(p_page-1,0)*25)
  select jsonb_build_object('total',(select count(*) from matched),'users',coalesce((
    select jsonb_agg(to_jsonb(p) || jsonb_build_object('usage',(
      select jsonb_build_object('requests',count(distinct request_id),'attempts',count(*),
        'errors',count(*) filter(where outcome='error'),
        'input_tokens',coalesce(sum(input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),
        'estimated_usd',coalesce(sum(estimated_usd),0),
        'unpriced',count(*) filter(where estimated_usd is null),
        'models',coalesce(jsonb_agg(distinct provider || '/' || model),'[]'::jsonb))
      from public.api_usage where user_id=p.id and created_at>=p_since
    ))) from page p),'[]'::jsonb));
$$;

create function public.admin_set_suspended(p_actor uuid,p_target uuid,p_suspended boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.app_admins where user_id=p_actor) then raise exception 'Forbidden'; end if;
  if exists(select 1 from public.app_admins where user_id=p_target) then raise exception 'Administrator accounts cannot be suspended'; end if;
  insert into public.account_controls values(p_target,p_suspended)
    on conflict(user_id) do update set suspended=excluded.suspended;
  insert into public.admin_audit(actor_id,target_id,action)
    values(p_actor,p_target,case when p_suspended then 'suspend' else 'restore' end);
end $$;

create function public.record_api_usage(p_user uuid,p_request uuid,p_provider text,p_model text,
  p_outcome text,p_input bigint,p_output bigint,p_units integer)
returns void language sql security definer set search_path = '' as $$
  insert into public.api_usage(user_id,request_id,provider,model,outcome,input_tokens,output_tokens,units,estimated_usd,pricing_source)
  select p_user,p_request,p_provider,p_model,p_outcome,p_input,p_output,p_units,
    case when r.provider is not null and p_outcome='success' and p_input is not null and p_output is not null then
      p_input*r.input_usd_per_million/1000000+p_output*r.output_usd_per_million/1000000+p_units*r.unit_usd else null end,
    r.source_url
  from (select 1) seed left join public.api_model_rates r on r.provider=p_provider and r.model=p_model
    and (r.valid_until is null or now()<r.valid_until)
  on conflict(request_id,provider) do nothing;
$$;
revoke all on function public.admin_users(text,integer,timestamptz), public.admin_set_suspended(uuid,uuid,boolean),
  public.record_api_usage(uuid,uuid,text,text,text,bigint,bigint,integer) from public,anon,authenticated;
grant execute on function public.admin_users(text,integer,timestamptz), public.admin_set_suspended(uuid,uuid,boolean),
  public.record_api_usage(uuid,uuid,text,text,text,bigint,bigint,integer) to service_role;
