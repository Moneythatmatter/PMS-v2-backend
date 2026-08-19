-- Patch: extend fo_check_out_reservation — hk_rooms DIRTY + checkout cleaning task
-- Run after housekeeping-tasks.sql

create or replace function public.fo_check_out_reservation(
  p_reservation_id text,
  p_payment_mode text default null,
  p_amount_received numeric default 0,
  p_payment_id text default null,
  p_transaction_no text default null,
  p_payment_date text default null,
  p_stay_history_id text default null,
  p_activity_id text default null,
  p_activity_message text default null,
  p_activity_timestamp text default null,
  p_created_by text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  r reservations%rowtype;
  g_name text;
  rm_type text;
  result jsonb;
  pay_mode text;
  v_task_id text;
begin
  select * into r from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;

  if r.status = 'Checked Out' then
    raise exception 'Reservation is already checked out' using errcode = 'P0001';
  end if;

  select name into g_name from guests where id = r.guest_id;

  if r.room_ref_id is not null and r.room_ref_id <> '' then
    select room_type into rm_type from rooms where id = r.room_ref_id;
  end if;

  pay_mode := coalesce(nullif(p_payment_mode, ''), r.payment_mode, 'Cash');

  update reservations
  set
    status = 'Checked Out',
    balance = 0,
    payment_mode = pay_mode
  where id = p_reservation_id
  returning to_jsonb(reservations.*) into result;

  if coalesce(p_amount_received, 0) > 0 then
    insert into payments (
      id, guest_name, room, reservation_id, amount, mode, type,
      transaction_no, date, status
    ) values (
      coalesce(p_payment_id, 'PAY-' || substr(md5(random()::text), 1, 8)),
      coalesce(g_name, 'Guest'),
      (select room_no from rooms where id = r.room_ref_id limit 1),
      p_reservation_id,
      p_amount_received,
      pay_mode,
      'Payment',
      coalesce(p_transaction_no, 'TXN-' || substr(md5(random()::text), 1, 8)),
      coalesce(p_payment_date, to_char(now(), 'DD Mon YYYY')),
      'Completed'
    );
  end if;

  if r.room_ref_id is not null and r.room_ref_id <> '' then
    update rooms
    set status = 'Dirty'
    where id = r.room_ref_id;

    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'housekeeping_tasks'
    ) then
      v_task_id := public.hk_create_checkout_task(
        r.room_ref_id,
        p_reservation_id,
        'Checkout cleaning for booking ' || coalesce(r.booking_no, p_reservation_id),
        p_created_by
      );
    elsif exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'hk_rooms'
    ) then
      perform public.hk_ensure_room_dirty(r.room_ref_id);
    end if;
  end if;

  if r.guest_id is not null and r.guest_id <> '' then
    insert into guest_stay_history (
      id, guest_id, check_in, check_out, room, room_type, amount
    ) values (
      coalesce(p_stay_history_id, 'SH-' || substr(md5(random()::text), 1, 8)),
      r.guest_id,
      r.check_in,
      r.check_out,
      (select room_no from rooms where id = r.room_ref_id limit 1),
      rm_type,
      coalesce(r.total_amount, 0)
    );
  end if;

  if p_activity_id is not null then
    insert into desk_activity (id, message, timestamp)
    values (p_activity_id, p_activity_message, p_activity_timestamp);
  end if;

  return result;
end;
$$;

grant execute on function public.fo_check_out_reservation(
  text, text, numeric, text, text, text, text, text, text, text, text
) to anon, authenticated;

notify pgrst, 'schema cache';
