-- Auto-create public.users profile row on Supabase Auth sign-up
-- Safety net: runs even if backend /auth/register is bypassed.
-- name is read from raw_user_meta_data which is set when signUp is called
-- with options.data = { name: '...' }

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, name, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'name',
    NOW()
  )
  ON CONFLICT (id) DO UPDATE
    SET name  = COALESCE(EXCLUDED.name, public.users.name),
        email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if any, then (re)create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
