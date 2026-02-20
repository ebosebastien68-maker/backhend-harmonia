// =====================================================
// CONFIGURATION SUPABASE — DEUX CLIENTS
// =====================================================
//
// 1. supabaseAdmin (SERVICE_ROLE)
//    → Disponible pour les autres fichiers du backend
//    → game.ts ne l'utilise PAS — tout passe par RPC ou ANON+JWT
//
// 2. getClientForUser(accessToken)
//    → Clé ANON + JWT de l'utilisateur
//    → auth.uid() fonctionne → RLS Supabase actif
//    → Utilisé dans game.ts pour toutes les opérations
//
// =====================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL         = process.env.SUPABASE_URL
const SUPABASE_ANON_KEY    = process.env.SUPABASE_ANON_KEY
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL)         throw new Error('❌ SUPABASE_URL manquante dans Render')
if (!SUPABASE_ANON_KEY)    throw new Error('❌ SUPABASE_ANON_KEY manquante dans Render')
if (!SUPABASE_SERVICE_KEY) throw new Error('❌ SUPABASE_SERVICE_KEY manquante dans Render')

// ── Client Admin (SERVICE_ROLE) ───────────────────────────────
// Pour les autres fichiers backend qui en ont besoin
// game.ts n'utilise PAS ce client
export const supabaseAdmin: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── Client utilisateur (ANON + JWT) ──────────────────────────
// auth.uid() fonctionne → RLS actif
// game.ts utilise UNIQUEMENT ce client
export function getClientForUser(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth:   { autoRefreshToken: false, persistSession: false }
  })
}

if (process.env.NODE_ENV === 'development') {
  console.log('✅ Supabase initialisé — SERVICE_ROLE (autres fichiers) + ANON+JWT (game.ts)')
}

// Export default = supabaseAdmin pour compatibilité avec les fichiers existants
// qui font : import supabase from '../config/supabase'
export default supabaseAdmin
  
