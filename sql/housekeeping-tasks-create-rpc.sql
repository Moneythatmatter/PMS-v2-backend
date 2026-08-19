-- Patch: fix "new row violates row-level security policy for table housekeeping_tasks"
-- Run once in Supabase SQL Editor, then: notify pgrst, 'schema cache';
--
-- 1) SECURITY DEFINER RPCs (work with anon API key — no service role required)
-- 2) Permissive RLS for anon + authenticated
-- 3) Drop users FK on staff columns (HK uses display names / hk_staff ids)

-- ---- RPC: mark hk_rooms dirty ----
create or replace function public.hk_ensure_room_dirty(p_room_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_room_id is null or trim(p_room_id) = '' then
    return;
  end if;

  insert into public.hk_rooms (room_id, status)
  values (p_room_id, 'DIRTY'::public.hk_room_status)
  on conflict (room_id) do update
    set status = 'DIRTY'::public.hk_room_status,
        updated_at = now();
end;
$$;

-- ---- RPC: create any cleaning task ----
create or replace function public.hk_create_task(
  p_room_id text,
  p_booking_id text default null,
  p_task_type public.hk_task_type default 'REGULAR_CLEANING',
  p_status public.hk_task_status default 'PENDING',
  p_priority public.hk_task_priority default 'MEDIUM',
  p_notes text default null,
  p_assigned_to text default null,
  p_created_by text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id text;
begin
  if p_room_id is null or trim(p_room_id) = '' then
    raise exception 'room_id is required' using errcode = 'P0001';
  end if;

  if p_status = 'PENDING'::public.hk_task_status
     and coalesce(p_task_type, 'REGULAR_CLEANING'::public.hk_task_type)
       <> 'INSPECTION'::public.hk_task_type then
    perform public.hk_ensure_room_dirty(p_room_id);
  end if;

  insert into public.housekeeping_tasks (
    room_id,
    booking_id,
    task_type,
    status,
    priority,
    notes,
    assigned_to,
    created_by
  ) values (
    p_room_id,
    nullif(trim(coalesce(p_booking_id, '')), ''),
    coalesce(p_task_type, 'REGULAR_CLEANING'::public.hk_task_type),
    coalesce(p_status, 'PENDING'::public.hk_task_status),
    coalesce(p_priority, 'MEDIUM'::public.hk_task_priority),
    nullif(trim(coalesce(p_notes, '')), ''),
    nullif(trim(coalesce(p_assigned_to, '')), ''),
    nullif(trim(coalesce(p_created_by, '')), '')
  )
  returning id into v_task_id;

  return v_task_id;
end;
$$;

-- ---- RPC: checkout task (reuse create logic) ----
create or replace function public.hk_create_checkout_task(
  p_room_id text,
  p_booking_id text,
  p_notes text default null,
  p_created_by text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_id text;
begin
  if p_room_id is null or trim(p_room_id) = '' then
    return null;
  end if;

  perform public.hk_ensure_room_dirty(p_room_id);

  if p_booking_id is not null and trim(p_booking_id) <> '' then
    select id into v_task_id
    from public.housekeeping_tasks
    where booking_id = p_booking_id
      and task_type = 'CHECKOUT_CLEANING'::public.hk_task_type
      and status not in (
        'APPROVED'::public.hk_task_status,
        'CANCELLED'::public.hk_task_status
      )
    limit 1;

    if v_task_id is not null then
      return v_task_id;
    end if;
  end if;

  return public.hk_create_task(
    p_room_id,
    p_booking_id,
    'CHECKOUT_CLEANING'::public.hk_task_type,
    'PENDING'::public.hk_task_status,
    'HIGH'::public.hk_task_priority,
    coalesce(
      nullif(trim(coalesce(p_notes, '')), ''),
      'Auto-created on guest checkout'
    ),
    null,
    p_created_by
  );
end;
$$;

grant execute on function public.hk_ensure_room_dirty(text) to anon, authenticated, service_role;
grant execute on function public.hk_create_task(
  text, text, public.hk_task_type, public.hk_task_status,
  public.hk_task_priority, text, text, text
) to anon, authenticated, service_role;
grant execute on function public.hk_create_checkout_task(text, text, text, text)
  to anon, authenticated, service_role;

-- ---- RLS: allow anon + authenticated (Express API uses anon key today) ----
do $$
declare
  t text;
begin
  foreach t in array array[
    'housekeeping_tasks',
    'hk_rooms',
    'public_areas',
    'guest_requests',
    'maintenance_requests',
    'hk_history'
  ]
  loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "anon_all_%s" on public.%I', t, t);
      execute format(
        'create policy "anon_all_%s" on public.%I for all to anon using (true) with check (true)',
        t, t
      );
      execute format('drop policy if exists "authenticated_all_%s" on public.%I', t, t);
      execute format(
        'create policy "authenticated_all_%s" on public.%I for all to authenticated using (true) with check (true)',
        t, t
      );
    end if;
  end loop;
end $$;

alter table public.housekeeping_tasks
  drop constraint if exists housekeeping_tasks_assigned_to_fkey;
alter table public.housekeeping_tasks
  drop constraint if exists housekeeping_tasks_created_by_fkey;
alter table public.housekeeping_tasks
  drop constraint if exists housekeeping_tasks_approved_by_fkey;

notify pgrst, 'schema cache';
