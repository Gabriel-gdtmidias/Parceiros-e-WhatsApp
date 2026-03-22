import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('URL do Supabase ou Chave Anon estão faltando. Por favor, configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY nas suas variáveis de ambiente.');
}

// Use a fallback to prevent crash, but log error
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', 
  supabaseAnonKey || 'placeholder'
);
