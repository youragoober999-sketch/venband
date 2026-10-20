-- Storage Console email queue: delivery tracking + top-staff update policy.
alter table public.outbound_emails add column if not exists sent_at timestamptz;
alter table public.outbound_emails add column if not exists error text;

drop policy if exists outbound_emails_update on public.outbound_emails;
create policy outbound_emails_update on public.outbound_emails for update to authenticated
  using (public.is_top_staff())
  with check (public.is_top_staff());
