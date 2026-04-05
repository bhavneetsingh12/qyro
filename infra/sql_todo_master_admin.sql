-- QYRO SQL TODO: Master Admin / Role setup
-- Run these manually in Railway Postgres when ready.

-- 1) Inspect current users
SELECT id, tenant_id, clerk_id, email, role, active
FROM public.users
ORDER BY created_at DESC;

-- 2) Promote a user to master_admin by email
-- Replace the email value before running.
UPDATE public.users
SET role = 'master_admin'
WHERE lower(email) = lower('you@example.com');

-- 3) Promote a user to master_admin by clerk_id
-- Replace the clerk_id value before running.
UPDATE public.users
SET role = 'master_admin'
WHERE clerk_id = 'user_xxxxxxxxxxxxx';

-- 4) Verify promotion worked
SELECT id, email, clerk_id, role
FROM public.users
WHERE role = 'master_admin';

-- 5) Roll back to owner (if needed)
-- Replace identity condition accordingly.
UPDATE public.users
SET role = 'owner'
WHERE lower(email) = lower('you@example.com');
