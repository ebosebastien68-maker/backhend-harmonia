// =====================================================
// HANDLER GAME - VERSION FINALE CONFORME BDD
// =====================================================

import { Request, Response } from 'express'
import supabase from '../config/supabase'

const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export async function handleGame(req: Request, res: Response) {
  const { function: functionName, user_id, ...params } = req.body

  console.log(`[${new Date().toISOString()}] 🎮 Game: ${functionName} | User: ${user_id || 'Public'}`);

  if (functionName !== 'listSessions' && !user_id) {
    return res.status(401).json({ error: 'user_id requis' })
  }

  if (user_id && !isValidUUID(user_id)) {
    return res.status(400).json({ error: 'user_id invalide' })
  }

  try {
    switch (functionName) {
      case 'listSessions': return await listSessions(params, res)
      case 'joinSession': return await joinSession(user_id, params, res)
      case 'getQuestions': return await getQuestions(user_id, params, res)
      case 'submitAnswer': return await submitAnswer(user_id, params, res)
      case 'getLeaderboard': return await getLeaderboard(user_id, params, res)
      default:
        return res.status(400).json({ error: `Action inconnue: ${functionName}` })
    }
  } catch (error: any) {
    console.error(`💥 CRASH GAME:`, error)
    return res.status(500).json({ error: 'Erreur serveur', details: error.message })
  }
}

// ========== FONCTIONS GAME ==========

async function listSessions(params: any, res: Response) {
  const { game_key } = params
  
  if (!game_key) {
    return res.status(400).json({ error: 'game_key requis' })
  }

  try {
    const { data: game } = await supabase
      .from('games')
      .select('id')
      .eq('key_name', game_key)
      .maybeSingle()

    if (!game) {
      return res.status(404).json({ error: 'Jeu non trouvé' })
    }

    const { data: sessions, error } = await supabase
      .from('game_sessions')
      .select('id, title, description, is_paid, price_cfa, created_at')
      .eq('game_id', game.id)
      .order('created_at', { ascending: false })

    if (error) throw error

    return res.json({ success: true, sessions: sessions || [] })

  } catch (error: any) {
    console.error('ERROR listSessions:', error)
    return res.status(500).json({ error: 'Erreur liste sessions', details: error.message })
  }
}

async function joinSession(userId: string, params: any, res: Response) {
  const { session_id } = params
  
  if (!session_id || !isValidUUID(session_id)) {
    return res.status(400).json({ error: 'session_id invalide' })
  }

  try {
    // Vérifier session
    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .select('is_paid, price_cfa')
      .eq('id', session_id)
      .maybeSingle()

    if (sessionError || !session) {
      return res.status(404).json({ error: 'Session non trouvée' })
    }

    // Gestion paiement
    if (session.is_paid) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('solde_cfa')
        .eq('id', userId)
        .single()

      if (!profile || profile.solde_cfa < session.price_cfa) {
        return res.status(400).json({ error: 'Solde insuffisant' })
      }

      await supabase
        .from('profiles')
        .update({ solde_cfa: profile.solde_cfa - session.price_cfa })
        .eq('id', userId)
    }

    // Trouver ou créer party
    let { data: party } = await supabase
      .from('game_parties')
      .select('id')
      .eq('session_id', session_id)
      .eq('is_initial', true)
      .maybeSingle()

    if (!party) {
      // Créer party initiale avec les VRAIS noms de colonnes
      const { data: newParty, error: partyError } = await supabase
        .from('game_parties')
        .insert({
          session_id,
          title: 'Party Principale',
          is_initial: true,      // ✅ Marquer comme party par défaut
          min_score: 0,         // ✅ Nom correct
          min_rank: null,       // ✅ Nom correct
          created_by: userId
        })
        .select()
        .single()

      if (partyError) throw partyError
      party = newParty
    }

    // Vérifier que party existe bien
    if (!party) {
      return res.status(500).json({ error: 'Impossible de créer ou trouver une party' })
    }

    // Ajouter joueur
    const { error: playerError } = await supabase
      .from('party_players')
      .insert({
        party_id: party.id,
        user_id: userId,
        score: 0
      })

    if (playerError && !playerError.message.includes('duplicate')) {
      throw playerError
    }

    return res.json({ success: true, message: 'Session rejointe' })

  } catch (error: any) {
    console.error('ERROR joinSession:', error)
    return res.status(500).json({ error: 'Erreur rejoindre session', details: error.message })
  }
}

async function getQuestions(userId: string, params: any, res: Response) {
  const { run_id } = params
  
  if (!run_id || !isValidUUID(run_id)) {
    return res.status(400).json({ error: 'run_id invalide' })
  }

  try {
    // Vérifier run
    const { data: run, error: runError } = await supabase
      .from('game_runs')
      .select('is_visible, is_closed, party_id')
      .eq('id', run_id)
      .maybeSingle()

    if (runError) throw runError
    if (!run) return res.status(404).json({ error: 'Run non trouvé' })
    if (!run.is_visible) return res.status(403).json({ error: 'Run non visible' })
    if (run.is_closed) return res.status(403).json({ error: 'Run fermé' })

    // Vérifier membre de la party
    const { data: player } = await supabase
      .from('party_players')
      .select('id')
      .eq('party_id', run.party_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!player) {
      return res.status(403).json({ error: 'Rejoignez d\'abord la session' })
    }

    // Récupérer questions
    const { data: questions, error: qError } = await supabase
      .from('run_questions')
      .select('id, question_text, score')
      .eq('run_id', run_id)
      .order('created_at', { ascending: true })

    if (qError) throw qError

    // Récupérer réponses déjà données
    const { data: answers } = await supabase
      .from('user_run_answers')
      .select('run_question_id')
      .eq('run_id', run_id)
      .eq('user_id', userId)

    const answeredIds = new Set(answers?.map(a => a.run_question_id) || [])

    const questionsWithStatus = questions?.map(q => ({
      ...q,
      answered: answeredIds.has(q.id)
    }))

    return res.json({ success: true, questions: questionsWithStatus || [] })

  } catch (error: any) {
    console.error('ERROR getQuestions:', error)
    return res.status(500).json({ error: 'Erreur questions', details: error.message })
  }
}

async function submitAnswer(_userId: string, params: any, res: Response) {
  const { run_question_id, answer } = params

  if (!run_question_id || typeof answer !== 'boolean') {
    return res.status(400).json({ error: 'run_question_id et answer requis' })
  }

  try {
    // Appeler la fonction RPC existante
    const { error } = await supabase.rpc('submit_answer', {
      p_run_question_id: run_question_id,
      p_answer: answer
    })

    if (error) {
      if (error.message.includes('already answered')) {
        return res.status(400).json({ error: 'Déjà répondu' })
      }
      if (error.message.includes('closed')) {
        return res.status(403).json({ error: 'Run fermé' })
      }
      throw error
    }

    return res.json({ success: true, message: 'Réponse enregistrée' })

  } catch (error: any) {
    console.error('ERROR submitAnswer:', error)
    return res.status(500).json({ error: 'Erreur réponse', details: error.message })
  }
}

async function getLeaderboard(userId: string, params: any, res: Response) {
  const { run_id } = params
  
  if (!run_id || !isValidUUID(run_id)) {
    return res.status(400).json({ error: 'run_id invalide' })
  }

  try {
    const { data: run, error: runError } = await supabase
      .from('game_runs')
      .select('party_id')
      .eq('id', run_id)
      .maybeSingle()

    if (runError) throw runError
    if (!run) return res.status(404).json({ error: 'Run non trouvé' })

    const { data: players, error: playersError } = await supabase
      .from('party_players')
      .select(`
        user_id,
        score,
        profiles:user_id (nom, prenom, avatar_url)
      `)
      .eq('party_id', run.party_id)
      .order('score', { ascending: false })

    if (playersError) throw playersError

    const leaderboard = players?.map((p: any, index: number) => ({
      rank: index + 1,
      user_id: p.user_id,
      score: p.score,
      nom: p.profiles?.nom || 'Joueur',
      prenom: p.profiles?.prenom || '',
      avatar_url: p.profiles?.avatar_url,
      is_current_user: p.user_id === userId
    }))

    return res.json({ success: true, leaderboard: leaderboard || [] })

  } catch (error: any) {
    console.error('ERROR getLeaderboard:', error)
    return res.status(500).json({ error: 'Erreur classement', details: error.message })
  }
}
