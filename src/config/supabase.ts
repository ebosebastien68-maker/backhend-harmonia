// =====================================================
// CONFIGURATION SUPABASE — CLÉ ANON UNIQUEMENT
// =====================================================
//
// ⚠️  RÈGLE ABSOLUE : On n'utilise JAMAIS la SERVICE_ROLE_KEY ici.
//
// Pourquoi la clé ANON et pas SERVICE_ROLE ?
// ─────────────────────────────────────────
// La SERVICE_ROLE_KEY bypass complètement les RLS (Row Level Security).
// Cela signifie que n'importe quelle requête peut lire correct_answer,
// score_awarded ou n'importe quelle donnée sensible, même si l'admin
// n'a pas encore révélé les résultats. C'est une faille de sécurité grave.
//
// Avec la clé ANON :
//   → Les politiques RLS de Supabase sont ACTIVES
//   → view_run_questions masque correct_answer tant que reveal_answers=false
//   → Seules les routes backend explicitement codées peuvent lire les données
//   → Le backend passe userId manuellement dans chaque requête
//
// =====================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl  = process.env.SUPABASE_URL
const supabaseAnon = process.env.SUPABASE_ANON_KEY   // ← ANON, jamais SERVICE_ROLE

if (!supabaseUrl)  throw new Error('❌ SUPABASE_URL manquante dans les variables Render')
if (!supabaseAnon) throw new Error('❌ SUPABASE_ANON_KEY manquante dans les variables Render')

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    autoRefreshToken: false,
    persistSession:   false,
  }
})

if (process.env.NODE_ENV === 'development') {
  console.log('✅ Client Supabase initialisé avec la clé ANON (RLS actif)')
}

export default supabase
