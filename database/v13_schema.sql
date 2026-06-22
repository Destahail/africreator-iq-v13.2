create extension if not exists "uuid-ossp";
create table if not exists creators (id uuid primary key default uuid_generate_v4(), profile_url text unique not null, username text, name text, profile_image text, country text default 'Ethiopia', city text, region text, category text default 'Food', language text default 'Amharic', followers bigint default 0, total_likes bigint default 0, video_count bigint default 0, avg_likes bigint default 0, engagement numeric default 0, growth numeric default 0, confidence numeric default 70, trust_score numeric default 70, brand_safety_score numeric default 75, audience_quality_score numeric default 70, campaign_fit_score numeric default 70, verified_status text default 'Unverified', influencer_current_state text default 'Active', influencing_level text default 'Medium', admin_intelligence_note text, campaign_history text, trend_participation text, contact_status text default 'locked', contact_email text, contact_phone text, data_source text default 'fallback_public_record', sync_mode text default 'auto_10_min', sync_status text default 'queued', message text, last_synced_at timestamptz, next_sync_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists creator_metric_history (id uuid primary key default uuid_generate_v4(), creator_id uuid references creators(id) on delete cascade, followers bigint default 0, total_likes bigint default 0, video_count bigint default 0, engagement numeric default 0, trust_score numeric default 0, captured_at timestamptz default now());
create table if not exists sync_logs (id uuid primary key default uuid_generate_v4(), creator_id uuid references creators(id) on delete set null, username text, type text, status text, message text, created_at timestamptz default now());
create table if not exists app_users (id uuid primary key default uuid_generate_v4(), full_name text, email text unique not null, company_name text, role text default 'brand', plan text default 'free', search_limit integer default 20, search_used integer default 0, contact_unlock_limit integer default 0, contact_unlock_used integer default 0, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists user_watchlists (id uuid primary key default uuid_generate_v4(), user_email text, creator_id uuid references creators(id) on delete cascade, list_name text default 'Default Watchlist', note text, created_at timestamptz default now());
create table if not exists campaigns (id uuid primary key default uuid_generate_v4(), title text not null, brand_name text, country text default 'Ethiopia', category text, objective text, budget_level text default 'Medium', status text default 'Planning', pipeline_stage text default 'Discovery', notes text, created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists campaign_briefs (id uuid primary key default uuid_generate_v4(), user_email text, brand_name text, campaign_goal text, country text, category text, budget_level text, generated_brief text, created_at timestamptz default now());
create table if not exists trends (id uuid primary key default uuid_generate_v4(), name text not null, platform text default 'TikTok', trend_scope text default 'Ethiopian', trend_type text default 'Hashtag', type text default 'Hashtag', country text default 'Ethiopia', region text, category text, trend_url text, description text, recommendation_note text, trend_status text default 'Rising', score numeric default 80, growth numeric default 10, status text default 'Published', created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists system_activity_logs (id uuid primary key default uuid_generate_v4(), user_email text, action text, entity_type text, entity_id text, message text, created_at timestamptz default now());
-- Normalize existing watchlist emails and remove duplicate rows before adding the constraint.
update user_watchlists
set user_email = lower(trim(user_email))
where user_email is not null and user_email <> lower(trim(user_email));

with duplicate_watchlists as (
  select id,
         row_number() over (
           partition by user_email, creator_id
           order by created_at asc, id asc
         ) as duplicate_number
  from user_watchlists
)
delete from user_watchlists
where id in (
  select id from duplicate_watchlists where duplicate_number > 1
);

-- Prevent duplicate saves of the same creator by the same user.
create unique index if not exists user_watchlists_user_creator_uidx
  on user_watchlists (user_email, creator_id);

-- Common query indexes.
create index if not exists creators_updated_at_idx on creators (updated_at desc);
create index if not exists creator_metric_history_creator_captured_idx on creator_metric_history (creator_id, captured_at desc);
create index if not exists sync_logs_created_at_idx on sync_logs (created_at desc);
create index if not exists campaigns_created_at_idx on campaigns (created_at desc);
create index if not exists trends_created_at_idx on trends (created_at desc);
