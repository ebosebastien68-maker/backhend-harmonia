// =====================================================
// HANDLER ADMIN - VERSION SÉCURISÉE
// CORRECTIONS :
//   [v2] Client auth temporaire jetable → supabaseAdmin intact (Service Role)
//   [v3] deleteRun : autorise suppression si run fermé (is_closed=true)
//   [v3] Logging détaillé : code + message + details Supabase pour debug
// =====================================================

import { Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import supabase from '../config/supabase'

const isValidUUID = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

// ─── Client temporaire pour vérification credentials uniquement ───────────────
// NE PAS utiliser supabaseAdmin pour signInWithPassword : ça mute son état
// in-memory et remplace la Service Role key par le JWT utilisateur →
// toutes les requêtes DB suivantes échouent (RLS au lieu de Service Role).
function createAuthClient() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ─── Helper logging Supabase ──────────────────────────────────────────────────
function logSupabaseError(context: string, error: any) {
  console.error(`❌ [${context}] Code: ${error?.code} | Message: ${error?.message} | Details: ${error?.details} | Hint: ${error?.hint}`)
}

export async function handleAdmin(req: Request, res: Response) {
  const { function: functionName, email, password, ...params } = req.body

  console.log(`[${new Date().toISOString()}] 🛠️ Admin: ${functionName} pour ${email}`)

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' })
  }

  try {
    // ========== AUTHENTIFICATION (client temporaire jetable) ==========
    const authClient = createAuthClient()
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email: email.trim(),
      password
    })

    if (authError || !authData.user) {
      console.warn(`⛔ Auth échouée: ${authError?.message}`)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' })
    }

    // ========== VÉRIFICATION PROFIL + RÔLE ==========
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, nom, prenom')
      .eq('id', authData.user.id)
      .maybeSingle()

    if (profileError || !profile) {
      logSupabaseError('getProfile', profileError)
      return res.status(403).json({ error: 'Profil inexistant' })
    }

    const normalizedRole = profile.role?.toString().toLowerCase().trim()
    const allowedRoles = ['admin', 'adminpro', 'supreme']

    console.log(`[AUTH] Rôle: "${normalizedRole}" | User: ${profile.prenom}`)

    if (!normalizedRole || !allowedRoles.includes(normalizedRole)) {
      return res.status(403).json({
        error: 'Droits insuffisants',
        votre_role: normalizedRole,
        roles_requis: allowedRoles
      })
    }

    if (functionName === 'login') {
      return res.json({
        success: true,
        user: { id: profile.id, nom: profile.nom, prenom: profile.prenom, role: normalizedRole }
      })
    }

    // ========== ROUTAGE ==========
    switch (functionName) {
      case 'createSession':     return await createSession(profile.id, params, res)
      case 'createParty':       return await createParty(profile.id, params, res)
      case 'createRun':         return await createRun(profile.id, params, res)
      case 'addQuestions':      return await addQuestions(profile.id, params, res)
      case 'setStarted':        return await setStarted(params, res)
      case 'setVisibility':     return await setVisibility(params, res)
      case 'closeRun':          return await closeRun(params, res)
      case 'listSessions':      return await listSessions(params, res)
      case 'listParties':       return await listParties(params, res)
      case 'listRuns':          return await listRuns(params, res)
      case 'listRunQuestions':  return await listRunQuestions(params, res)
      case 'getStatistics':     return await getStatistics(params, res)
      case 'getPartyPlayers':   return await getPartyPlayers(params, res)
      case 'deleteSession':     return await deleteSession(params, res)
      case 'deleteParty':       return await deleteParty(params, res)
      case 'deleteRun':         return await deleteRun(params, res)
      case 'deleteQuestion':    return await deleteQuestion(params, res)
      default:
        return res.status(400).json({ error: `Fonction inconnue: ${functionName}` })
    }

  } catch (error: any) {
    console.error(`💥 CRASH ADMIN [${req.body?.function}]:`, error?.message, error?.stack)
    return res.status(500).json({ error: 'Erreur serveur', details: error.message })
  }
}

// =====================================================
// CREATE SESSION
// =====================================================

async function createSession(adminId: string, params: any, res: Response) {
  const { game_key, title, description, is_paid, price_cfa, section_id } = params

  if (!game_key || !title) {
    return res.status(400).json({ error: 'game_key et title requis' })
  }

  if (is_paid && (!price_cfa || price_cfa <= 0)) {
    return res.status(400).json({ error: 'price_cfa doit être > 0 si la session est payante' })
  }

  if (!is_paid && price_cfa > 0) {
    return res.status(400).json({ error: 'price_cfa doit être 0 si la session est gratuite' })
  }

  if (section_id && !isValidUUID(section_id)) {
    return res.status(400).json({ error: 'section_id invalide' })
  }

  try {
    const { data: game } = await supabase
      .from('games')
      .select('id')
      .eq('key_name', game_key)
      .maybeSingle()

    if (!game) return res.status(404).json({ error: 'Jeu non trouvé', game_key })

    if (section_id) {
      const { data: section } = await supabase
        .from('game_sections')
        .select('id')
        .eq('id', section_id)
        .eq('game_id', game.id)
        .maybeSingle()

      if (!section) return res.status(404).json({ error: 'Section non trouvée pour ce jeu' })
    }

    const { data, error } = await supabase
      .from('game_sessions')
      .insert({
        game_id:     game.id,
        title,
        description: description || null,
        is_paid:     !!is_paid,
        price_cfa:   is_paid ? price_cfa : 0,
        section_id:  section_id || null,
        created_by:  adminId
      })
      .select()
      .single()

    if (error) { logSupabaseError('createSession', error); throw error }

    console.log(`✅ Session créée: ${data.id}`)
    return res.json({ success: true, session_id: data.id, message: 'Session créée' })

  } catch (error: any) {
    console.error('ERROR createSession:', error.message)
    return res.status(500).json({ error: 'Erreur création session', details: error.message })
  }
}

// =====================================================
// CREATE PARTY
// =====================================================

async function createParty(adminId: string, params: any, res: Response) {
  const { session_id, title, min_score, min_rank } = params

  if (!session_id || !title) {
    return res.status(400).json({ error: 'session_id et title requis' })
  }

  if (!isValidUUID(session_id)) {
    return res.status(400).json({ error: 'session_id invalide' })
  }

  try {
    const { data, error } = await supabase
      .from('game_parties')
      .insert({
        session_id,
        title,
        is_initial: false,
        min_score:  min_score ?? 0,
        min_rank:   min_rank ?? null,
        created_by: adminId
      })
      .select()
      .single()

    if (error) { logSupabaseError('createParty', error); throw error }

    console.log(`✅ Party créée: ${data.id}`)
    return res.json({ success: true, party_id: data.id, message: 'Party créée' })

  } catch (error: any) {
    console.error('ERROR createParty:', error.message)
    return res.status(500).json({ error: 'Erreur création party', details: error.message })
  }
}

// =====================================================
// CREATE RUN
// =====================================================

async function createRun(adminId: string, params: any, res: Response) {
  const { party_id, title } = params

  if (!party_id || !title) {
    return res.status(400).json({ error: 'party_id et title requis' })
  }

  if (!isValidUUID(party_id)) {
    return res.status(400).json({ error: 'party_id invalide' })
  }

  try {
    const { data, error } = await supabase
      .from('game_runs')
      .insert({
        party_id,
        title,
        created_by:     adminId,
        is_visible:     false,
        is_closed:      false,
        is_started:     false,
        reveal_answers: false
      })
      .select()
      .single()

    if (error) { logSupabaseError('createRun', error); throw error }

    console.log(`✅ Run créé: ${data.id}`)
    return res.json({ success: true, run_id: data.id, message: 'Run créé' })

  } catch (error: any) {
    console.error('ERROR createRun:', error.message)
    return res.status(500).json({ error: 'Erreur création run', details: error.message })
  }
}

// =====================================================
// ADD QUESTIONS
// =====================================================

async function addQuestions(adminId: string, params: any, res: Response) {
  const { run_id, questions } = params

  if (!run_id || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'run_id et questions (tableau non vide) requis' })
  }

  if (!isValidUUID(run_id)) {
    return res.status(400).json({ error: 'run_id invalide' })
  }

  try {
    const { data: run } = await supabase
      .from('game_runs')
      .select('is_started, is_visible')
      .eq('id', run_id)
      .maybeSingle()

    if (!run) return res.status(404).json({ error: 'Run non trouvé' })

    if (run.is_started || run.is_visible) {
      return res.status(403).json({
        error: 'Impossible d\'ajouter des questions : le run est déjà démarré ou visible'
      })
    }

    const payload = questions.map((q: any) => ({
      run_id,
      question_text:  q.question,
      correct_answer: !!q.answer,
      score:          q.score ?? 10,
      created_by:     adminId
    }))

    const { data, error } = await supabase.from('run_questions').insert(payload).select()
    if (error) { logSupabaseError('addQuestions', error); throw error }

    console.log(`✅ ${data.length} questions ajoutées`)
    return res.json({ success: true, count: data.length, message: `${data.length} question(s) ajoutée(s)` })

  } catch (error: any) {
    console.error('ERROR addQuestions:', error.message)
    return res.status(500).json({ error: 'Erreur ajout questions', details: error.message })
  }
}

// =====================================================
// SET STARTED — ÉTAPE 1
// =====================================================

async function setStarted(params: any, res: Response) {
  const { run_id, started } = params

  if (!run_id || typeof started !== 'boolean') {
    return res.status(400).json({ error: 'run_id et started (boolean) requis' })
  }

  try {
    if (started) {
      const { count } = await supabase
        .from('run_questions')
        .select('*', { count: 'exact', head: true })
        .eq('run_id', run_id)

      if (!count || count === 0) {
        return res.status(400).json({ error: 'Impossible de démarrer : aucune question dans ce run' })
      }
    }

    const { error } = await supabase
      .from('game_runs')
      .update({ is_started: started })
      .eq('id', run_id)

    if (error) { logSupabaseError('setStarted', error); throw error }

    console.log(`✅ is_started = ${started} pour run: ${run_id}`)
    return res.json({ success: true, message: started ? 'Run démarré (prêt à lancer)' : 'Run réinitialisé' })

  } catch (error: any) {
    console.error('ERROR setStarted:', error.message)
    return res.status(500).json({ error: 'Erreur démarrage run', details: error.message })
  }
}

// =====================================================
// SET VISIBILITY — ÉTAPE 2
// =====================================================

async function setVisibility(params: any, res: Response) {
  const { run_id, visible } = params

  if (!run_id || typeof visible !== 'boolean') {
    return res.status(400).json({ error: 'run_id et visible (boolean) requis' })
  }

  try {
    if (visible) {
      const { data: run } = await supabase
        .from('game_runs')
        .select('is_started, is_closed')
        .eq('id', run_id)
        .maybeSingle()

      if (!run) return res.status(404).json({ error: 'Run non trouvé' })

      if (!run.is_started) {
        return res.status(400).json({ error: 'Démarrez le run (setStarted) avant de le rendre visible' })
      }

      if (run.is_closed) {
        return res.status(400).json({ error: 'Run déjà fermé — impossible de le rendre visible' })
      }
    }

    const { error } = await supabase.rpc('set_run_visibility', {
      p_run_id:  run_id,
      p_visible: visible
    })
    if (error) { logSupabaseError('setVisibility', error); throw error }

    console.log(`✅ is_visible = ${visible} pour run: ${run_id}`)
    return res.json({ success: true, message: visible ? 'Run visible — joueurs notifiés par polling' : 'Run masqué' })

  } catch (error: any) {
    console.error('ERROR setVisibility:', error.message)
    return res.status(500).json({ error: 'Erreur visibilité', details: error.message })
  }
}

// =====================================================
// CLOSE RUN — ÉTAPE 3
// =====================================================

async function closeRun(params: any, res: Response) {
  const { run_id, closed } = params

  if (!run_id || typeof closed !== 'boolean') {
    return res.status(400).json({ error: 'run_id et closed (boolean) requis' })
  }

  try {
    const { error } = await supabase.rpc('set_run_closed', {
      p_run_id: run_id,
      p_closed: closed
    })
    if (error) { logSupabaseError('closeRun', error); throw error }

    console.log(`✅ is_closed = ${closed} pour run: ${run_id}`)
    return res.json({
      success: true,
      message: closed
        ? 'Run fermé — bonne réponse et scores révélés aux joueurs'
        : 'Run réouvert — réponses acceptées à nouveau'
    })

  } catch (error: any) {
    console.error('ERROR closeRun:', error.message)
    return res.status(500).json({ error: 'Erreur fermeture run', details: error.message })
  }
}

// =====================================================
// LIST SESSIONS (admin)
// =====================================================

async function listSessions(params: any, res: Response) {
  const { game_key, game_id } = params

  if (!game_key && !game_id) {
    return res.status(400).json({ error: 'game_key ou game_id requis' })
  }

  try {
    let resolvedGameId = game_id

    if (!resolvedGameId) {
      const { data: game } = await supabase
        .from('games')
        .select('id')
        .eq('key_name', game_key)
        .maybeSingle()

      if (!game) return res.status(404).json({ error: 'Jeu non trouvé' })
      resolvedGameId = game.id
    }

    const { data: sessions, error } = await supabase
      .from('game_sessions')
      .select(`
        id, title, description, is_paid, price_cfa,
        section_id, created_by, created_at,
        game_sections (title)
      `)
      .eq('game_id', resolvedGameId)
      .order('created_at', { ascending: false })

    if (error) { logSupabaseError('listSessions', error); throw error }

    return res.json({ success: true, sessions: sessions || [] })

  } catch (error: any) {
    console.error('ERROR listSessions:', error.message)
    return res.status(500).json({ error: 'Erreur liste sessions', details: error.message })
  }
}

// =====================================================
// LIST PARTIES
// =====================================================

async function listParties(params: any, res: Response) {
  const { session_id } = params

  if (!session_id || !isValidUUID(session_id)) {
    return res.status(400).json({ error: 'session_id invalide' })
  }

  try {
    const { data: parties, error } = await supabase
      .from('game_parties')
      .select('id, title, is_initial, min_score, min_rank, created_by, created_at')
      .eq('session_id', session_id)
      .order('created_at', { ascending: true })

    if (error) { logSupabaseError('listParties', error); throw error }

    return res.json({ success: true, parties: parties || [] })

  } catch (error: any) {
    console.error('ERROR listParties:', error.message)
    return res.status(500).json({ error: 'Erreur liste parties', details: error.message })
  }
}

// =====================================================
// LIST RUNS
// =====================================================

async function listRuns(params: any, res: Response) {
  const { party_id } = params

  if (!party_id || !isValidUUID(party_id)) {
    return res.status(400).json({ error: 'party_id invalide' })
  }

  try {
    const { data: runs, error } = await supabase
      .from('game_runs')
      .select('id, title, is_visible, is_closed, is_started, reveal_answers, created_by, created_at')
      .eq('party_id', party_id)
      .order('created_at', { ascending: true })

    if (error) { logSupabaseError('listRuns', error); throw error }

    return res.json({ success: true, runs: runs || [] })

  } catch (error: any) {
    console.error('ERROR listRuns:', error.message)
    return res.status(500).json({ error: 'Erreur liste runs', details: error.message })
  }
}

// =====================================================
// LIST RUN QUESTIONS (admin)
// =====================================================

async function listRunQuestions(params: any, res: Response) {
  const { run_id } = params

  if (!run_id || !isValidUUID(run_id)) {
    return res.status(400).json({ error: 'run_id invalide' })
  }

  try {
    const { data: questions, error } = await supabase
      .from('run_questions')
      .select('id, run_id, question_text, correct_answer, score, created_at')
      .eq('run_id', run_id)
      .order('created_at', { ascending: true })

    if (error) { logSupabaseError('listRunQuestions', error); throw error }

    return res.json({ success: true, questions: questions || [] })

  } catch (error: any) {
    console.error('ERROR listRunQuestions:', error.message)
    return res.status(500).json({ error: 'Erreur liste questions', details: error.message })
  }
}

// =====================================================
// GET STATISTICS
// =====================================================

async function getStatistics(params: any, res: Response) {
  const { run_id } = params

  if (!run_id || !isValidUUID(run_id)) {
    return res.status(400).json({ error: 'run_id invalide' })
  }

  try {
    const { data: run, error: runError } = await supabase
      .from('game_runs')
      .select('*')
      .eq('id', run_id)
      .maybeSingle()

    if (runError) { logSupabaseError('getStatistics/run', runError); throw runError }
    if (!run) return res.status(404).json({ error: 'Run introuvable' })

    const [
      { count: questionsCount },
      { count: answersCount },
      { count: playersCount }
    ] = await Promise.all([
      supabase.from('run_questions').select('*', { count: 'exact', head: true }).eq('run_id', run_id),
      supabase.from('user_run_answers').select('*', { count: 'exact', head: true }).eq('run_id', run_id),
      supabase.from('party_players').select('*', { count: 'exact', head: true }).eq('party_id', run.party_id)
    ])

    return res.json({
      success: true,
      statistics: {
        id:              run.id,
        title:           run.title,
        is_visible:      run.is_visible,
        is_closed:       run.is_closed,
        is_started:      run.is_started,
        reveal_answers:  run.reveal_answers,
        total_questions: questionsCount || 0,
        total_answers:   answersCount   || 0,
        total_players:   playersCount   || 0
      }
    })

  } catch (error: any) {
    console.error('ERROR getStatistics:', error.message)
    return res.status(500).json({ error: 'Erreur stats', details: error.message })
  }
}

// =====================================================
// GET PARTY PLAYERS
// =====================================================

async function getPartyPlayers(params: any, res: Response) {
  const { party_id } = params

  if (!party_id || !isValidUUID(party_id)) {
    return res.status(400).json({ error: 'party_id invalide' })
  }

  try {
    const { data: players, error } = await supabase
      .from('party_players')
      .select(`
        user_id,
        score,
        profiles:user_id (nom, prenom, avatar_url)
      `)
      .eq('party_id', party_id)
      .order('score', { ascending: false })

    if (error) { logSupabaseError('getPartyPlayers', error); throw error }

    const formatted = (players || []).map((p: any, index: number) => ({
      rank:       index + 1,
      user_id:    p.user_id,
      score:      p.score,
      nom:        p.profiles?.nom    || 'Joueur',
      prenom:     p.profiles?.prenom || '',
      avatar_url: p.profiles?.avatar_url ?? null
    }))

    return res.json({ success: true, players: formatted })

  } catch (error: any) {
    console.error('ERROR getPartyPlayers:', error.message)
    return res.status(500).json({ error: 'Erreur joueurs party', details: error.message })
  }
}

// =====================================================
// DELETE SESSION
// Toutes les FK ont ON DELETE CASCADE en BDD →
// suppression automatique de toutes les données enfants
// =====================================================

async function deleteSession(params: any, res: Response) {
  const { session_id } = params

  if (!session_id || !isValidUUID(session_id)) {
    return res.status(400).json({ error: 'session_id invalide' })
  }

  try {
    console.log(`🗑️ Tentative suppression session: ${session_id}`)

    const { error } = await supabase
      .from('game_sessions')
      .delete()
      .eq('id', session_id)

    if (error) {
      logSupabaseError('deleteSession', error)
      throw error
    }

    console.log(`✅ Session supprimée: ${session_id}`)
    return res.json({ success: true, message: 'Session supprimée' })

  } catch (error: any) {
    console.error('ERROR deleteSession:', error.message)
    return res.status(500).json({ error: 'Erreur suppression session', details: error.message })
  }
}

// =====================================================
// DELETE PARTY
// =====================================================

async function deleteParty(params: any, res: Response) {
  const { party_id } = params

  if (!party_id || !isValidUUID(party_id)) {
    return res.status(400).json({ error: 'party_id invalide' })
  }

  try {
    const { data: party } = await supabase
      .from('game_parties')
      .select('is_initial')
      .eq('id', party_id)
      .maybeSingle()

    if (!party) return res.status(404).json({ error: 'Party non trouvée' })

    if (party.is_initial) {
      return res.status(403).json({ error: 'La party initiale ne peut pas être supprimée' })
    }

    console.log(`🗑️ Tentative suppression party: ${party_id}`)

    const { error } = await supabase
      .from('game_parties')
      .delete()
      .eq('id', party_id)

    if (error) {
      logSupabaseError('deleteParty', error)
      throw error
    }

    console.log(`✅ Party supprimée: ${party_id}`)
    return res.json({ success: true, message: 'Party supprimée' })

  } catch (error: any) {
    console.error('ERROR deleteParty:', error.message)
    return res.status(500).json({ error: 'Erreur suppression party', details: error.message })
  }
}

// =====================================================
// DELETE RUN
// [FIX v3] : autorise suppression si run fermé (is_closed=true)
// Bloque uniquement si en cours : démarré ET pas encore fermé
// =====================================================

async function deleteRun(params: any, res: Response) {
  const { run_id } = params

  if (!run_id || !isValidUUID(run_id)) {
    return res.status(400).json({ error: 'run_id invalide' })
  }

  try {
    const { data: run } = await supabase
      .from('game_runs')
      .select('is_started, is_closed')
      .eq('id', run_id)
      .maybeSingle()

    if (!run) return res.status(404).json({ error: 'Run non trouvé' })

    // Bloquer uniquement si en cours (démarré ET pas encore fermé)
    // Un run fermé peut toujours être supprimé
    if (run.is_started && !run.is_closed) {
      return res.status(403).json({
        error: 'Impossible de supprimer un run en cours. Fermez-le d\'abord (étape 3 — Fermer & Révéler).'
      })
    }

    console.log(`🗑️ Tentative suppression run: ${run_id}`)

    const { error } = await supabase.from('game_runs').delete().eq('id', run_id)
    if (error) {
      logSupabaseError('deleteRun', error)
      throw error
    }

    console.log(`✅ Run supprimé: ${run_id}`)
    return res.json({ success: true, message: 'Run supprimé' })

  } catch (error: any) {
    console.error('ERROR deleteRun:', error.message)
    return res.status(500).json({ error: 'Erreur suppression run', details: error.message })
  }
}

// =====================================================
// DELETE QUESTION
// =====================================================

async function deleteQuestion(params: any, res: Response) {
  const { question_id } = params

  if (!question_id || !isValidUUID(question_id)) {
    return res.status(400).json({ error: 'question_id invalide' })
  }

  try {
    console.log(`🗑️ Tentative suppression question: ${question_id}`)

    const { error } = await supabase
      .from('run_questions')
      .delete()
      .eq('id', question_id)

    if (error) {
      logSupabaseError('deleteQuestion', error)
      if (error.message.includes('started')) {
        return res.status(403).json({ error: 'Impossible de supprimer : le run a déjà démarré' })
      }
      throw error
    }

    console.log(`✅ Question supprimée: ${question_id}`)
    return res.json({ success: true, message: 'Question supprimée' })

  } catch (error: any) {
    console.error('ERROR deleteQuestion:', error.message)
    return res.status(500).json({ error: 'Erreur suppression question', details: error.message })
  }
}
