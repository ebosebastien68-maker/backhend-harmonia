// =====================================================
// HANDLER ADMIN - VERSION CORRIGÉE (RENDER & SUPABASE)
// =====================================================

import { Request, Response } from 'express'
import supabase from '../config/supabase' // Utilise ton client Service Role configuré

export async function handleAdmin(req: Request, res: Response) {
  // Extraction des paramètres
  const { function: functionName, email, password, ...params } = req.body

  console.log(`[${new Date().toISOString()}] 🛠️ Admin Request: ${functionName}`)

  // 1. Validation basique
  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' })
  }

  try {
    // =====================================================
    // ÉTAPE 1 : AUTHENTIFICATION (Via Service Role)
    // =====================================================
    
    // On vérifie les identifiants
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password
    })

    if (authError || !authData.user) {
      console.warn(`⛔ Auth échouée pour ${email}: ${authError?.message}`)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' })
    }

    // =====================================================
    // ÉTAPE 2 : VÉRIFICATION DU RÔLE (Table profiles)
    // =====================================================

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, nom, prenom')
      .eq('id', authData.user.id)
      .maybeSingle() // Utilise maybeSingle pour éviter le crash si vide

    // Gestion cas profil inexistant
    if (profileError || !profile) {
      console.error(`⛔ Profil introuvable pour ${authData.user.id}`)
      return res.status(403).json({ error: 'Profil introuvable. Contactez le support.' })
    }

    // Vérification des droits Admin
    const allowedRoles = ['admin', 'adminpro', 'supreme']
    if (!allowedRoles.includes(profile.role)) {
      console.warn(`⛔ Accès refusé. Rôle actuel : ${profile.role}`)
      return res.status(403).json({ 
        error: 'Accès refusé : Droits insuffisants',
        current_role: profile.role 
      })
    }

    console.log(`✅ Admin identifié : ${profile.prenom} (${profile.role})`)

    // =====================================================
    // ÉTAPE 3 : ROUTAGE DES FONCTIONS (CRUD DIRECT)
    // =====================================================

    switch (functionName) {
      case 'createSession':
        return await createSession(profile.id, params, res)
      case 'createParty':
        return await createParty(profile.id, params, res)
      case 'createRun':
        return await createRun(profile.id, params, res)
      case 'addQuestions':
        return await addQuestions(profile.id, params, res)
      case 'setVisibility':
        return await setVisibility(params, res)
      case 'closeRun':
        return await closeRun(params, res)
      case 'getStatistics':
        return await getStatistics(params, res)
      default:
        return res.status(400).json({ 
          error: `Fonction inconnue: ${functionName}`,
          available: ['createSession', 'createParty', 'createRun', 'addQuestions', 'setVisibility', 'closeRun', 'getStatistics']
        })
    }

  } catch (error: any) {
    console.error(`💥 CRASH SERVEUR handleAdmin:`, error)
    // C'est ici que l'erreur 500 est générée proprement avec des détails
    return res.status(500).json({ 
      error: 'Erreur interne du serveur', 
      details: error.message || 'Erreur inconnue' 
    })
  }
}

// =====================================================
// FONCTIONS MÉTIER (Utilisant Insert/Update standards)
// =====================================================

async function createSession(adminId: string, params: any, res: Response) {
  const { game_key, title, description, is_paid, price_cfa } = params
  
  if (!game_key || !title) return res.status(400).json({ error: 'game_key et title requis' })

  // 1. Trouver le jeu
  const { data: game } = await supabase.from('games').select('id').eq('key_name', game_key).maybeSingle()
  if (!game) return res.status(404).json({ error: `Jeu non trouvé avec la clé: ${game_key}` })

  // 2. Créer la session
  const { data, error } = await supabase.from('game_sessions').insert({
    game_id: game.id,
    title,
    description,
    is_paid: is_paid || false,
    price_cfa: price_cfa || 0,
    created_by: adminId
  }).select().single()

  if (error) throw error
  return res.json({ success: true, session_id: data.id, message: 'Session créée' })
}

async function createParty(adminId: string, params: any, res: Response) {
  const { session_id, title, min_score, min_rank } = params

  if (!session_id || !title) return res.status(400).json({ error: 'session_id et title requis' })

  // Insert direct dans game_parties (remplace create_party_for_session RPC)
  const { data, error } = await supabase.from('game_parties').insert({
    session_id,
    title,
    min_score_required: min_score || 0,
    min_rank_required: min_rank || null,
    created_by: adminId,
    status: 'waiting' // Assurez-vous que votre table a ce statut par défaut ou ajustez
  }).select().single()

  if (error) throw error
  return res.json({ success: true, party_id: data.id, message: 'Partie créée' })
}

async function createRun(adminId: string, params: any, res: Response) {
  const { party_id, title } = params

  if (!party_id || !title) return res.status(400).json({ error: 'party_id et title requis' })

  // Insert direct dans game_runs (remplace create_run RPC)
  const { data, error } = await supabase.from('game_runs').insert({
    party_id,
    title,
    created_by: adminId,
    is_visible: false,
    is_closed: false,
    is_started: false
  }).select().single()

  if (error) throw error
  return res.json({ success: true, run_id: data.id, message: 'Run créé' })
}

async function addQuestions(adminId: string, params: any, res: Response) {
  const { run_id, questions } = params

  if (!run_id || !Array.isArray(questions)) return res.status(400).json({ error: 'run_id et tableau questions requis' })

  // Préparation des données
  const questionsToInsert = questions.map((q: any) => ({
    run_id,
    question_text: q.question,
    correct_answer: q.answer, // Assurez-vous que c'est un booléen
    score: q.score || 10,
    created_by: adminId
  }))

  const { data, error } = await supabase.from('run_questions').insert(questionsToInsert).select()

  if (error) throw error
  return res.json({ success: true, count: data.length, message: `${data.length} questions ajoutées` })
}

async function setVisibility(params: any, res: Response) {
  const { run_id, visible } = params
  
  // Update direct (remplace set_run_visibility RPC)
  const { error } = await supabase
    .from('game_runs')
    .update({ is_visible: visible })
    .eq('id', run_id)

  if (error) throw error
  return res.json({ success: true, message: visible ? 'Run visible' : 'Run masqué' })
}

async function closeRun(params: any, res: Response) {
  const { run_id, closed } = params

  // Update direct (remplace set_run_closed RPC)
  const { error } = await supabase
    .from('game_runs')
    .update({ is_closed: closed })
    .eq('id', run_id)

  if (error) throw error
  return res.json({ success: true, message: closed ? 'Run fermé' : 'Run ouvert' })
}

async function getStatistics(params: any, res: Response) {
  const { run_id } = params
  if (!run_id) return res.status(400).json({ error: 'run_id requis' })

  // Récupération parallèle des infos
  const [runRes, qRes, aRes] = await Promise.all([
    supabase.from('game_runs').select('*').eq('id', run_id).single(),
    supabase.from('run_questions').select('*', { count: 'exact', head: true }).eq('run_id', run_id),
    supabase.from('user_run_answers').select('*', { count: 'exact', head: true }).eq('run_id', run_id)
  ])

  if (runRes.error) throw runRes.error

  return res.json({
    success: true,
    statistics: {
      run_id,
      title: runRes.data.title,
      is_visible: runRes.data.is_visible,
      is_closed: runRes.data.is_closed,
      is_started: runRes.data.is_started,
      total_questions: qRes.count || 0,
      total_answers: aRes.count || 0
    }
  })
}
