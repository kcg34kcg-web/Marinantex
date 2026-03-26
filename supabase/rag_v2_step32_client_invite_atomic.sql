-- Step 32: Atomic client + invite creation helper
-- Purpose:
--   Prevent partial writes when a new client row is created and invite insert fails.

create or replace function public.create_client_invite_atomic(
  p_full_name text,
  p_email text,
  p_phone text,
  p_tc_identity text,
  p_party_type text,
  p_file_no text,
  p_created_by uuid,
  p_invited_by uuid,
  p_username text,
  p_contact_name text,
  p_expires_at timestamptz,
  p_token text
)
returns table (
  client_id uuid,
  client_full_name text,
  client_email text,
  client_file_no text,
  client_public_ref_code text,
  invite_id uuid,
  invite_email text,
  invite_full_name text,
  invite_username text,
  invite_tc_identity text,
  invite_contact_name text,
  invite_phone text,
  invite_party_type text,
  invite_target_role text,
  invite_expires_at timestamptz,
  invite_accepted_at timestamptz,
  invite_created_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_client_id uuid;
  v_client_full_name text;
  v_client_email text;
  v_client_file_no text;
  v_client_public_ref_code text;

  v_invite_id uuid;
  v_invite_email text;
  v_invite_full_name text;
  v_invite_username text;
  v_invite_tc_identity text;
  v_invite_contact_name text;
  v_invite_phone text;
  v_invite_party_type text;
  v_invite_target_role public.user_role;
  v_invite_expires_at timestamptz;
  v_invite_accepted_at timestamptz;
  v_invite_created_at timestamptz;
begin
  insert into public.clients (
    full_name,
    email,
    phone,
    tc_identity,
    party_type,
    file_no,
    status,
    created_by
  )
  values (
    p_full_name,
    p_email,
    p_phone,
    p_tc_identity,
    p_party_type,
    p_file_no,
    'invited',
    p_created_by
  )
  returning
    id,
    full_name,
    email,
    file_no,
    public_ref_code
  into
    v_client_id,
    v_client_full_name,
    v_client_email,
    v_client_file_no,
    v_client_public_ref_code;

  v_invite_full_name := p_full_name;
  v_invite_username := p_username;
  v_invite_tc_identity := p_tc_identity;
  v_invite_contact_name := p_contact_name;
  v_invite_phone := p_phone;
  v_invite_party_type := p_party_type;

  begin
    insert into public.user_invites (
      email,
      full_name,
      username,
      tc_identity,
      contact_name,
      phone,
      party_type,
      target_role,
      token,
      invited_by,
      invited_client_id,
      expires_at
    )
    values (
      p_email,
      p_full_name,
      p_username,
      p_tc_identity,
      p_contact_name,
      p_phone,
      p_party_type,
      'client',
      p_token,
      p_invited_by,
      v_client_id,
      p_expires_at
    )
    returning
      id,
      email,
      full_name,
      username,
      tc_identity,
      contact_name,
      phone,
      party_type,
      target_role,
      expires_at,
      accepted_at,
      created_at
    into
      v_invite_id,
      v_invite_email,
      v_invite_full_name,
      v_invite_username,
      v_invite_tc_identity,
      v_invite_contact_name,
      v_invite_phone,
      v_invite_party_type,
      v_invite_target_role,
      v_invite_expires_at,
      v_invite_accepted_at,
      v_invite_created_at;
  exception
    when undefined_column then
      insert into public.user_invites (
        email,
        target_role,
        token,
        invited_by,
        expires_at
      )
      values (
        p_email,
        'client',
        p_token,
        p_invited_by,
        p_expires_at
      )
      returning
        id,
        email,
        target_role,
        expires_at,
        accepted_at,
        created_at
      into
        v_invite_id,
        v_invite_email,
        v_invite_target_role,
        v_invite_expires_at,
        v_invite_accepted_at,
        v_invite_created_at;
  end;

  update public.clients
  set source_invite_id = v_invite_id
  where id = v_client_id;

  return query
  select
    v_client_id,
    v_client_full_name,
    v_client_email,
    v_client_file_no,
    v_client_public_ref_code,
    v_invite_id,
    v_invite_email,
    v_invite_full_name,
    v_invite_username,
    v_invite_tc_identity,
    v_invite_contact_name,
    v_invite_phone,
    v_invite_party_type,
    v_invite_target_role::text,
    v_invite_expires_at,
    v_invite_accepted_at,
    v_invite_created_at;
end;
$$;

revoke all on function public.create_client_invite_atomic(
  text, text, text, text, text, text, uuid, uuid, text, text, timestamptz, text
) from public;

grant execute on function public.create_client_invite_atomic(
  text, text, text, text, text, text, uuid, uuid, text, text, timestamptz, text
) to service_role;
