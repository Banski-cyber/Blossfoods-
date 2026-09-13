/* ============================================================
   SUPABASE CONNECTION
   Get these two values from: Supabase Dashboard > Project Settings > API Keys
   - Project URL                    -> SUPABASE_URL
   - "Publishable" key (sb_publishable_...) -> SUPABASE_PUBLISHABLE_KEY
     (Older projects may instead show it as the "anon public" key —
     that works exactly the same way, just paste it in below.)
   This key is safe to expose in frontend code — it only grants whatever
   Row Level Security policies in schema.sql allow.
   ============================================================ */

const SUPABASE_URL = 'https://dvklfbdncyoxwhxsfppn.supabase.co/rest/v1/';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_dCxVm6mmTRJ-awe2FCsWCg_6OPO6xcy';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
