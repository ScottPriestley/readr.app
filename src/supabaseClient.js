import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://hbkdrpbefratpvtzvmjt.supabase.co'
const supabaseAnonKey = 'sb_publishable_Kz4mjannQ_t4XwKeGiWvog_HAmvgjUu'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)