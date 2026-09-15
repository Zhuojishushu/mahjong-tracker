-- ============================================================
-- 麻雀トラッカー v10 スキーマ修正（緊急）
-- 新規登録が「column reference "name" is ambiguous」で失敗する不具合の修正
--
-- 原因: mj_register は returns table (id, name, is_admin) を宣言しており、
--       この name が関数内では変数として扱われる。本体の
--       「where name = p_name」が players.name なのか戻り値の name なのか
--       判別できず、PostgreSQL が曖昧と判断してエラーになっていた。
-- 対処: テーブルに別名（pl）を付けて、すべての列参照を修飾する。
--
-- Supabase SQL Editor で Run してください（アプリ側の変更は不要です）
-- ============================================================

create or replace function mj_register(p_name text, p_pin_hash text)
returns table (id uuid, name text, is_admin boolean)
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_name text;
begin
  v_name := btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception '名前を入力してください';
  end if;
  if char_length(v_name) > 20 then
    raise exception '名前は20文字までです';
  end if;
  if exists (select 1 from players pl where pl.name = v_name) then
    raise exception '同じ名前が既に登録されています';
  end if;

  insert into players (name, pin_hash) values (v_name, p_pin_hash)
  returning players.id into v_id;

  return query
    select pl.id, pl.name, pl.is_admin
    from players pl
    where pl.id = v_id;
end $$;

grant execute on function mj_register(text, text) to anon, authenticated;
