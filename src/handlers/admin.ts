// =====================================================
// HANDLER ADMIN - VERSION DIAGNOSTIC PROFOND
// =====================================================

import { Request, Response } from 'express'
import supabase from '../config/supabase'

export async function handleAdmin(req: Request, res: Response) {
  const { function: functionName, email, password, ...params } = req.body

  console.log(`[${new Date().toISOString()}] 🛠️ Requête Admin: ${functionName} pour ${email}`);

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
      console.warn(`⛔ Auth échouée: ${authError?.message}`)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' })
    }

    const uid = authData.user.id;

    // =====================================================
    // ÉTAPE 2 : DIAGNOSTIC DE VISIBILITÉ (TEST RLS)
    // =====================================================
    // On vérifie si le serveur "voit" au moins un profil dans la table
    const { count: totalVisibles, error: testError } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    console.log(`[DIAGNOSTIC RENDER] UID: ${uid}`);
    console.log(`[DIAGNOSTIC RENDER] Profils accessibles par le serveur: ${totalVisibles ?? 0}`);
    if (testError) console.error(`[DIAGNOSTIC RENDER] Erreur test visibilité:`, testError.message);

    // =====================================================
    // ÉTAPE 3 : VÉRIFICATION DU RÔLE
    // =====================================================
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, nom, prenom')
      .eq('id', uid)
      .maybeSingle()

    if (profileError) {
      console.error(`❌ Erreur SQL Supabase:`, profileError.message);
      return res.status(500).json({ error: 'Erreur base de données', details: profileError.message });
    }

    if (!profile) {
      console.error(`⛔ Profil introuvable pour l'UID: ${uid}`);
      return res.status(403).json({ 
        error: 'Accès refusé : Profil inexistant',
        debug: {
          uid_tente: uid,
          total_visibles: totalVisibles ?? 0,
          info: "Si total_visibles est 0, la clé service_role est absente ou bloquée par la RLS."
        }
      })
    }

    // --- NORMALISATION DU RÔLE ---
    const rawRole = profile.role;
    const normalizedRole = rawRole?.toString().toLowerCase().trim();
    const allowedRoles = ['admin', 'adminpro', 'supreme'];

    console.log(`[DEBUG AUTH] Rôle brut: "${rawRole}" | Rôle normalisé: "${normalizedRole}"`);

    if (!normalizedRole || !allowedRoles.includes(normalizedRole)) {
      console.warn(`⛔ Accès refusé. Rôle "${normalizedRole}" non autorisé.`);
      return res.status(403).json({ 
        error: 'Droits insuffisants',
        votre_role: normalizedRole
      })
    }

    console.log(`✅ Accès validé pour ${profile.prenom} (${normalizedRole})`)

    // =====================================================
    // ÉTAPE 4 : ROUTAGE DES FONCTIONS
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
    console.error(`💥 CRASH SERVEUR:`, error)
    return res.status(500).json({ error: 'Erreur serveur', details: error.message })
  }
}

// =====================================================
// FONCTIONS MÉTIER (INSERT / UPDATE DIRECTS)
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

  const [runRes, qRes, aRes] = await Promise.all([
    supabase.from('game_runs').select('*').eq('id', run_id).single(),
    supabase.from('run_questions').select('*', { count: 'exact', head: true }).eq('run_id', run_id),
    supabase.from('user_run_answers').select('*', { count: 'exact', head: true }).eq('run_id', run_id)
  ])

  if (runRes.error) throw runRes.error
  return res.json({
    success: true,
    statistics: {
      ...runRes.data,
      total_questions: qRes.count || 0,
      total_answers: aRes.count || 0
    }
  })
}
