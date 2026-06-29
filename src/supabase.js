// =============================================================================
// SUPABASE CLIENT
// Connects the app to your Supabase project (database + auth).
// Credentials come from .env — never commit that file to git.
// =============================================================================

import { createClient } from '@supabase/supabase-js'

// Vite exposes env vars that start with VITE_ to the browser at build time
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'Missing Supabase env vars. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to a .env file at the project root, then restart the dev server.',
  )
}

// Single shared client used everywhere in main.js
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
