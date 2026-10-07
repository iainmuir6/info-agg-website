-- 13 — Morning push notifications for the two AI briefings.
--
-- Delivery is NOT built here. This project's Supabase is shared by several
-- apps, and Web Push for all of them runs through one platform layer: the
-- `notify` schema (subscriptions, preferences, a debounced event queue) and
-- the `notify-dispatch` Edge Function, both kept in the cmf-tracker repo —
-- supabase/migrations/20261007120000_notify_platform.sql and
-- docs/notifications.md there. Apply that first; this file only plugs
-- info_agg into it, and touches nothing outside info_agg except by calling
-- notify's functions.
--
-- Two topics, one per briefing: `summary.day` and `summary.week`. When the
-- daily ETL writes a new briefing into misc_content, a trigger enqueues it
-- for the next WAKING moment in New York — the daily run lands ~5–6am ET, so
-- in practice 7:00am; a briefing regenerated mid-day goes out at once; one
-- written after 9pm waits for the morning. Both briefings written the same
-- morning (Mondays) share an event and arrive as ONE notification.

-- ----------------------------------------------------------- audience

-- Anybody who opted in: the briefings are public content, so there is no
-- scope to apply beyond the person's own switch. Not executable by any API
-- role (it lists users); notify.deliveries() calls it as the definer.
create or replace function info_agg.notify_audience(p_audience jsonb)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select distinct p.user_id from notify.preferences p
   where p.app = 'info_agg' and p.enabled;
$$;
revoke all on function info_agg.notify_audience(jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------ trigger

create or replace function info_agg.notify_summary_written()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_when  timestamptz;
  v_label text;
begin
  if new.kind <> 'summary' or new.key not in ('day', 'week') then
    return new;
  end if;
  -- The ETL's freshness gate means an unchanged re-run writes nothing, but
  -- an upsert of an identical payload would still fire an UPDATE — skip it.
  if tg_op = 'UPDATE' and old.payload is not distinct from new.payload then
    return new;
  end if;

  v_when  := notify.next_waking(now(), 'America/New_York', 7, 21);
  v_label := case new.key when 'day' then 'Summary of the Day'
                          else 'Summary of the Week' end;

  perform notify.enqueue(
    p_app         => 'info_agg',
    p_topic       => 'summary.' || new.key,
    p_group_key   => 'briefings:' || to_char(v_when at time zone 'America/New_York', 'YYYY-MM-DD'),
    p_item        => jsonb_build_object(
                       'ref',   'summary:' || new.key,
                       'title', v_label,
                       'body',  coalesce(nullif(new.payload->>'headline', ''),
                                         'Your new briefing is ready.'),
                       'line',  v_label,
                       'url',   '/summary'),
    p_group_title => 'Your briefings are ready',
    p_group_url   => '/summary',
    p_audience    => '{}'::jsonb,
    p_quiet       => interval '2 minutes',
    p_max_hold    => interval '30 minutes',
    p_not_before  => v_when
  );
  return new;
exception when others then
  -- A notification is never worth the briefing: the row is written, the
  -- failure is a log line.
  raise warning 'info_agg.notify_summary_written: % (%)', sqlerrm, sqlstate;
  return new;
end;
$$;
revoke all on function info_agg.notify_summary_written() from public, anon, authenticated;

drop trigger if exists misc_content_notify_summary on info_agg.misc_content;
create trigger misc_content_notify_summary
  after insert or update of payload on info_agg.misc_content
  for each row execute function info_agg.notify_summary_written();

-- ------------------------------------------------- browser-facing RPCs
-- Pin the app to 'info_agg' and hand off. Any signed-in user may opt in.

create or replace function info_agg.notify_settings(p_endpoint text default null)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select notify.settings('info_agg', p_endpoint);
$$;

create or replace function info_agg.notify_subscribe(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns void
language sql security definer set search_path = ''
as $$
  select notify.save_subscription('info_agg', p_endpoint, p_p256dh, p_auth, p_user_agent);
$$;

create or replace function info_agg.notify_unsubscribe(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$
  select notify.remove_subscription('info_agg', p_endpoint);
$$;

create or replace function info_agg.notify_set_topic(p_topic text, p_enabled boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_topic not in ('summary.day', 'summary.week') then
    raise exception 'unknown topic %', p_topic using errcode = '22023';
  end if;
  perform notify.set_preference('info_agg', p_topic, p_enabled);
end;
$$;

revoke all on function info_agg.notify_settings(text)                  from public, anon;
revoke all on function info_agg.notify_subscribe(text, text, text, text) from public, anon;
revoke all on function info_agg.notify_unsubscribe(text)               from public, anon;
revoke all on function info_agg.notify_set_topic(text, boolean)        from public, anon;
grant execute on function info_agg.notify_settings(text)                  to authenticated;
grant execute on function info_agg.notify_subscribe(text, text, text, text) to authenticated;
grant execute on function info_agg.notify_unsubscribe(text)               to authenticated;
grant execute on function info_agg.notify_set_topic(text, boolean)        to authenticated;
