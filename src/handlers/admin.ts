// =====================================================
// HANDLER ADMIN - VERSION PRODUCTION (NETTOYÉE)
// =====================================================

import { Request, Response } from 'express'
import supabase from '../config/supabase'

export async function handleAdmin(req: Request, res: Response) {
  const { function: functionName, email, password, ...params } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' })
  }

  try {
    // =====================================================
    // ÉTAPE 1 : AUTHENTIFICATION
    // =====================================================
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password
    })

    if (authError || !authData.user) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' })
    }

    // =====================================================
    // ÉTAPE 2 : VÉRIFICATION DU RÔLE
    // =====================================================
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, nom, prenom')
      .eq('id', authData.user.id)
      .maybeSingle()

    if (profileError || !profile) {
      console.error(`⛔ Accès refusé pour l'UID: ${authData.user.id}`);
      return res.status(403).json({ error: 'Accès refusé : Profil inexistant' })
    }

    // Normalisation du rôle pour la vérification
    const normalizedRole = profile.role?.toString().toLowerCase().trim();
    const allowedRoles = ['admin', 'adminpro', 'supreme'];

    if (!normalizedRole || !allowedRoles.includes(normalizedRole)) {
      return res.status(403).json({ error: 'Droits insuffisants' })
    }

    console.log(`✅ ${profile.prenom} connecté en tant que ${normalizedRole}`);

    // =====================================================
    // ÉTAPE 3 : ROUTAGE DES FONCTIONS
    // =====================================================
    switch (functionName) {
      case 'createSession': return await createSession(profile.id, params, res)
      case 'createParty':   return await createParty(profile.id, params, res)
      case 'createRun':     return await createRun(profile.id, params, res)
      case 'addQuestions':  return await addQuestions(profile.id, params, res)
      case 'setVisibility': return await setVisibility(params, res)
      case 'closeRun':      return await closeRun(params, res)
      case 'getStatistics': return await getStatistics(params, res)
      default:
        return res.status(400).json({ error: `Fonction inconnue: ${functionName}` })
    }

  } catch (error: any) {
    console.error(`💥 ERREUR SERVEUR:`, error.message)
    return res.status(500).json({ error: 'Erreur interne du serveur' })
  }
}

// =====================================================
// FONCTIONS MÉTIER
// =====================================================

async function createSession(adminId: string, params: any, res: Response) {
  const { game_key, title, description, is_paid, price_cfa } = params
  if (!game_key || !title) return res.status(400).json({ error: 'game_key et title requis' })

  const { data: game } = await supabase.from('games').select('id').eq('key_name', game_key).maybeSingle()
  if (!game) return res.status(404).json({ error: 'Jeu non trouvé' })

  const { data, error } = await supabase.from('game_sessions').insert({
    game_id: game.id,
    title,
    description,
    is_paid: !!is_paid,
    price_cfa: price_cfa || 0,
    created_by: adminId
  }).select().single()

  if (error) throw error
  return res.json({ success: true, session_id: data.id })
}

async function createParty(adminId: string, params: any, res: Response) {
  const { session_id, title, min_score, min_rank } = params
  if (!session_id || !title) return res.status(400).json({ error: 'session_id et title requis' })

  const { data, error } = await supabase.from('game_parties').insert({
    session_id,
    title,
    min_score_required: min_score || 0,
    min_rank_required: min_rank || null,
    created_by: adminId,
    status: 'waiting'
  }).select().single()

  if (error) throw error
  return res.json({ success: true, party_id: data.id })
}

async function createRun(adminId: string, params: any, res: Response) {
  const { party_id, title } = params
  if (!party_id || !title) return res.status(400).json({ error: 'party_id et title requis' })

  const { data, error } = await supabase.from('game_runs').insert({
    party_id,
    title,
    created_by: adminId,
    is_visible: false,
    is_closed: false,
    is_started: false
  }).select().single()

  if (error) throw error
  return res.json({ success: true, run_id: data.id })
}

async function addQuestions(adminId: string, params: any, res: Response) {
  const { run_id, questions } = params
  if (!run_id || !Array.isArray(questions)) return res.status(400).json({ error: 'Paramètres invalides' })

  const payload = questions.map((q: any) => ({
    run_id,
    question_text: q.question,
    correct_answer: !!q.answer,
    score: q.score || 10,
    created_by: adminId
  }))

  const { data, error } = await supabase.from('run_questions').insert(payload).select()
  if (error) throw error
  return res.json({ success: true, count: data.length })
}

async function setVisibility(params: any, res: Response) {
  const { run_id, visible } = params
  const { error } = await supabase.from('game_runs').update({ is_visible: !!visible }).eq('id', run_id)
  if (error) throw error
  return res.json({ success: true })
}

async function closeRun(params: any, res: Response) {
  const { run_id, closed } = params
  const { error } = await supabase.from('game_runs').update({ is_closed: !!closed }).eq('id', run_id)
  if (error) throw error
  return res.json({ success: true })
}

async function getStatistics(params: any, res: Response) {
  const { run_id } = params
  if (!run_id) return res.status(400).json({ error: 'run_id requis' })

  // Validation du format UUID pour éviter l'erreur 22P02 (crash Postgres)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(run_id)) {
    return res.status(400).json({ error: 'Format de run_id invalide' });
  }

  const [runRes, qRes, aRes] = await Promise.all([
    supabase.from('game_runs').select('*').eq('id', run_id).maybeSingle(),
    supabase.from('run_questions').select('*', { count: 'exact', head: true }).eq('run_id', run_id),
    supabase.from('user_run_answers').select('*', { count: 'exact', head: true }).eq('run_id', run_id)
  ])

  if (runRes.error) throw runRes.error
  if (!runRes.data) return res.status(404).json({ error: 'Run non trouvé' })

  return res.json({
    success: true,
    statistics: {
      ...runRes.data,
      total_questions: qRes.count || 0,
      total_answers: aRes.count || 0
    }
  })
}
