-- Run in Supabase SQL Editor. Store all balances as integer AirCoins.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 telegram_id text primary key,
 username text,
 first_name text not null default 'Player',
 aircoins bigint not null default 0 check (aircoins >= 0),
 created_at timestamptz not null default now()
);
create table if not exists public.scores (
 id uuid primary key default gen_random_uuid(),
 telegram_id text not null references public.profiles(telegram_id) on delete cascade,
 game_id text not null,
 score integer not null check(score >= 0),
 duration_seconds integer not null default 0 check(duration_seconds >= 0),
 created_at timestamptz not null default now()
);
create index if not exists scores_game_score_idx on public.scores(game_id,score desc,created_at asc);
create or replace view public.leaderboard_view as
 select distinct on (s.game_id,s.telegram_id) s.game_id,s.telegram_id,p.username,s.score,s.created_at
 from public.scores s join public.profiles p using(telegram_id)
 order by s.game_id,s.telegram_id,s.score desc,s.created_at asc;
create table if not exists public.reward_claims (
 id uuid primary key default gen_random_uuid(),
 telegram_id text not null references public.profiles(telegram_id) on delete cascade,
 provider text not null,
 placement_id text not null,
 provider_claim_id text not null unique,
 amount integer not null default 1 check(amount=1),
 created_at timestamptz not null default now()
);
create index if not exists reward_claims_user_day_idx on public.reward_claims(telegram_id,created_at desc);
create table if not exists public.withdrawal_requests (
 id uuid primary key default gen_random_uuid(),
 telegram_id text not null references public.profiles(telegram_id),
 amount bigint not null check(amount>=100),
 destination text not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected','paid')),
 tx_hash text,
 admin_telegram_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.ledger (
 id uuid primary key default gen_random_uuid(),
 telegram_id text not null references public.profiles(telegram_id),
 delta bigint not null,
 reason text not null,
 reference_id text,
 created_at timestamptz not null default now(),
 unique(reason,reference_id)
);
alter table public.profiles enable row level security;
alter table public.scores enable row level security;
alter table public.reward_claims enable row level security;
alter table public.withdrawal_requests enable row level security;
alter table public.ledger enable row level security;
-- Browser clients must not write directly. Use the backend service role only; never ship it to frontend.
revoke all on public.profiles,public.scores,public.reward_claims,public.withdrawal_requests,public.ledger from anon,authenticated;

create or replace function public.submit_score(p_telegram_id text,p_game_id text,p_score integer,p_duration_seconds integer)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if p_score<0 or p_score>1000000 or p_duration_seconds<0 or p_duration_seconds>86400 then raise exception 'INVALID_SCORE'; end if;
 if not exists(select 1 from profiles where telegram_id=p_telegram_id) then
   insert into profiles(telegram_id) values(p_telegram_id) on conflict do nothing;
 end if;
 insert into scores(telegram_id,game_id,score,duration_seconds) values(p_telegram_id,p_game_id,p_score,p_duration_seconds);
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.request_withdrawal(p_telegram_id text,p_amount bigint,p_destination text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare current_balance bigint; new_id uuid;
begin
 if p_amount<100 then raise exception 'MIN_WITHDRAWAL'; end if;
 select aircoins into current_balance from profiles where telegram_id=p_telegram_id for update;
 if current_balance is null or current_balance<p_amount then raise exception 'INSUFFICIENT_BALANCE'; end if;
 update profiles set aircoins=aircoins-p_amount where telegram_id=p_telegram_id;
 insert into withdrawal_requests(telegram_id,amount,destination) values(p_telegram_id,p_amount,p_destination) returning id into new_id;
 insert into ledger(telegram_id,delta,reason,reference_id) values(p_telegram_id,-p_amount,'withdrawal_reserved',new_id::text);
 return jsonb_build_object('id',new_id,'status','pending','amount',p_amount);
end $$;

create or replace function public.admin_update_withdrawal(p_request_id uuid,p_status text,p_tx_hash text,p_admin_id text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r withdrawal_requests%rowtype;
begin
 select * into r from withdrawal_requests where id=p_request_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if r.status in ('paid','rejected') then raise exception 'ALREADY_FINAL'; end if;
 if p_status='rejected' then
   update profiles set aircoins=aircoins+r.amount where telegram_id=r.telegram_id;
   insert into ledger(telegram_id,delta,reason,reference_id) values(r.telegram_id,r.amount,'withdrawal_refund',r.id::text) on conflict do nothing;
 end if;
 update withdrawal_requests set status=p_status,tx_hash=p_tx_hash,admin_telegram_id=p_admin_id,updated_at=now() where id=p_request_id returning * into r;
 return jsonb_build_object('id',r.id,'status',r.status,'txHash',r.tx_hash);
end $$;
revoke all on function public.submit_score(text,text,integer,integer) from public,anon,authenticated;
revoke all on function public.request_withdrawal(text,bigint,text) from public,anon,authenticated;
revoke all on function public.admin_update_withdrawal(uuid,text,text,text) from public,anon,authenticated;
