// =====================================================
// CONFIGURATION SUPABASE
// =====================================================
// Rôle : Créer un client Supabase réutilisable dans
//        tout le backend
// =====================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Récupérer les variables d'environnement
const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

// Vérifier que les variables sont définies
if (!supabaseUrl) {
  throw new Error('❌ SUPABASE_URL manquante dans .env')
}

if (!supabaseServiceKey) {
  throw new Error('❌ SUPABASE_SERVICE_KEY manquante dans .env')
}

// Créer le client Supabase avec la SERVICE_ROLE_KEY
// Cette clé permet de bypasser les RLS (Row Level Security)
// et d'accéder à toutes les données
const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

// Log de confirmation (seulement en dev)
if (process.env.NODE_ENV === 'development') {
  console.log('✅ Client Supabase initialisé')
}

export default supabase
