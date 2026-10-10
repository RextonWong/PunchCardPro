begin;
insert into auth.users(id,email) values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin-regression@example.test'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','user-regression@example.test');
insert into public.app_admins values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.workplaces(id,name,owner_id) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Test Site','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.workplaces where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc')<>1 then raise exception 'Active owner cannot read'; end if;
 if has_table_privilege('authenticated','public.app_admins','SELECT') then raise exception 'Admin allowlist exposed'; end if;
 if has_function_privilege('authenticated','public.admin_users(text,integer,timestamp with time zone)','EXECUTE') then raise exception 'Admin RPC exposed'; end if;
end $$;
reset role;
select public.admin_set_suspended('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
set local role authenticated;
do $$ begin
 if public.account_is_active() then raise exception 'Suspension not immediate'; end if;
 if exists(select 1 from public.workplaces where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') then raise exception 'Suspended user can read'; end if;
 begin
  insert into public.workplaces(name,owner_id) values('Blocked','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  raise exception 'Suspended user can write';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select public.admin_set_suspended('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
select public.record_api_usage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dddddddd-dddd-4ddd-8ddd-dddddddddddd','gemini','test-model','success',100,50,0);
select public.record_api_usage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','dddddddd-dddd-4ddd-8ddd-dddddddddddd','gemini','test-model','success',100,50,0);
insert into public.api_model_rates(provider,model,input_usd_per_million,output_usd_per_million,source_url,verified_at)
values('gemini','test-model',1,2,'https://example.test/pricing',now());
select public.record_api_usage('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','gemini','test-model','success',100,50,0);
do $$ declare result jsonb; begin
 if not public.account_is_active() then raise exception 'Restore failed'; end if;
 if (select count(*) from public.admin_audit where target_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')<>2 then raise exception 'Audit missing'; end if;
 if (select count(*) from public.api_usage where user_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')<>2 then raise exception 'Usage duplicate'; end if;
 if (select estimated_usd from public.api_usage where request_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')<>0.0002 then raise exception 'Price calculation wrong'; end if;
 result:=public.admin_users('user-regression@example.test',1,now()-interval '1 day');
 if (result->'users'->0->'usage'->>'unpriced')::int<>1 then raise exception 'Unpriced not visible'; end if;
 begin
  perform public.admin_set_suspended('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  raise exception 'Admin suspension allowed';
 exception when raise_exception then
  if SQLERRM<>'Administrator accounts cannot be suspended' then raise; end if;
 end;
end $$;
rollback;
