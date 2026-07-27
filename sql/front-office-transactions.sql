-- Front Office transactional RPCs (run in Supabase SQL Editor)
-- Each function runs as a single Postgres transaction: all succeed or all roll back.

create or replace function public.fo_check_in_reservation(
  p_reservation_id text,
  p_activity_id text,
  p_activity_message text,
  p_activity_timestamp text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  r reservations%rowtype;
  result jsonb;
begin
  select * into r from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;

  if r.status in ('Checked Out') then
    raise exception 'Cannot check in a checked-out reservation' using errcode = 'P0001';
  end if;

  if r.status in ('Checked In', 'In-House') then
    raise exception 'Guest is already checked in' using errcode = 'P0001';
  end if;

  update reservations
  set status = 'Checked In', arriving_today = false
  where id = p_reservation_id
  returning to_jsonb(reservations.*) into result;

  if r.room_no is not null and r.room_no <> '' then
    update rooms
    set
      status = 'Occupied',
      guest_name = r.guest_name,
      housekeeping = 'Clean',
      checkout_date = r.check_out
    where room_no = r.room_no;
  end if;

  insert into desk_activity (id, message, timestamp)
  values (p_activity_id, p_activity_message, p_activity_timestamp);

  return result;
end;
$$;

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
  p_activity_timestamp text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  r reservations%rowtype;
  result jsonb;
  pay_mode text;
begin
  select * into r from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;

  if r.status = 'Checked Out' then
    raise exception 'Reservation is already checked out' using errcode = 'P0001';
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
      r.guest_name,
      r.room_no,
      p_reservation_id,
      p_amount_received,
      pay_mode,
      'Payment',
      coalesce(p_transaction_no, 'TXN-' || substr(md5(random()::text), 1, 8)),
      coalesce(p_payment_date, to_char(now(), 'DD Mon YYYY')),
      'Completed'
    );
  end if;

  if r.room_no is not null and r.room_no <> '' then
    update rooms
    set
      status = 'Dirty',
      guest_name = null,
      housekeeping = 'Dirty',
      checkout_date = null
    where room_no = r.room_no;
  end if;

  if r.guest_id is not null and r.guest_id <> '' then
    insert into guest_stay_history (
      id, guest_id, check_in, check_out, room, room_type, amount
    ) values (
      coalesce(p_stay_history_id, 'SH-' || substr(md5(random()::text), 1, 8)),
      r.guest_id,
      r.check_in,
      r.check_out,
      r.room_no,
      r.room_type,
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

grant execute on function public.fo_check_in_reservation(text, text, text, text) to anon, authenticated;
grant execute on function public.fo_check_out_reservation(text, text, numeric, text, text, text, text, text, text, text) to anon, authenticated;
