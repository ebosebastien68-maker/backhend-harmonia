// =====================================================
// HANDLER GAME - VERSION PRODUCTION CORRIGÉE (TS)
// =====================================================

import { Request, Response } from 'express'
import supabase from '../config/supabase'

// Helper pour valider les UUID
const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export async function handleGame(req: Request, res: Response) {
  const { function: functionName, user_id, ...params } = req.body

  console.log(`[${new Date().toISOString()}] 🎮 Game Action: ${functionName} | User: ${user_id || 'Public'}`);

  if (functionName !== 'listSessions' && !user_id) {
    return res.status(401).json({ error: 'Identification utilisateur (user_id) requise' })
  }

  if (user_id && !isValidUUID(user_id)) {
    return res.status(400).json({ error: 'ID utilisateur invalide' })
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
    console.error(`💥 CRASH GAME HANDLER:`, error)
    return res.status(500).json({ error: 'Erreur serveur game', details: error.message })
  }
}

async function listSessions(params: any, res: Response) {
  const { game_key } = params
  if (!game_key) return res.status(400).json({ error: 'game_key requis' })

  const { data: game } = await supabase.from('games').select('id').eq('key_name', game_key).maybeSingle()
  if (!game) return res.status(404).json({ error: 'Jeu non trouvé' })

  const { data: sessions, error } = await supabase
    .from('game_sessions')
    .select('id, title, description, is_paid, price_cfa, created_at')
    .eq('game_id', game.id)
    .order('created_at', { ascending: false })

  if (error) throw error
  return res.json({ success: true, sessions: sessions || [] })
}

async function joinSession(userId: string, params: any, res: Response) {
  const { session_id } = params
  if (!session_id || !isValidUUID(session_id)) return res.status(400).json({ error: 'session_id invalide' })

  const { error } = await supabase.rpc('join_session_secure', { 
    p_user_id: userId, 
    p_session_id: session_id 
  })

  if (error) return res.status(400).json({ error: error.message })

  return res.json({ success: true, message: 'Session rejointe avec succès' })
}

async function getQuestions(userId: string, params: any, res: Response) {
  const { run_id } = params
  if (!run_id || !isValidUUID(run_id)) return res.status(400).json({ error: 'run_id invalide' })

  // Correction de l'erreur TS6133 : on utilise 'error' au lieu de 'runErr' et on le check
  const { data: run, error: errorRun } = await supabase
    .from('game_runs')
    .select('is_visible, is_closed, is_started')
    .eq('id', run_id)
    .maybeSingle()

  if (errorRun) throw errorRun;
  if (!run || !run.is_visible) return res.status(403).json({ error: 'Ce run n\'est pas encore public' })
  if (run.is_closed) return res.status(403).json({ error: 'Ce run est terminé' })

  const { data: questions, error: errorQ } = await supabase
    .from('run_questions')
    .select('id, question_text, score')
    .eq('run_id', run_id)
    .order('created_at', { ascending: true })

  if (errorQ) throw errorQ

  const { data: myAnswers } = await supabase
    .from('user_run_answers')
    .select('run_question_id')
    .eq('run_id', run_id)
    .eq('user_id', userId)

  const answeredIds = new Set(myAnswers?.map(a => a.run_question_id))

  const questionsFinal = questions?.map(q => ({
    ...q,
    already_answered: answeredIds.has(q.id)
  }))

  return res.json({ success: true, questions: questionsFinal || [] })
}

async function submitAnswer(userId: string, params: any, res: Response) {
  const { run_id, question_id, answer } = params

  if (!run_id || !question_id || typeof answer !== 'boolean') {
    return res.status(400).json({ error: 'Paramètres manquants ou format incorrect' })
  }

  const { data, error } = await supabase.rpc('submit_game_answer', {
    p_user_id: userId,
    p_run_id: run_id,
    p_question_id: question_id,
    p_answer: answer
  })

  if (error) return res.status(400).json({ error: error.message })

  return res.json({ 
    success: true, 
    is_correct: data?.is_correct, 
    points_earned: data?.points_earned 
  })
}

async function getLeaderboard(userId: string, params: any, res: Response) {
  const { run_id } = params
  if (!run_id || !isValidUUID(run_id)) return res.status(400).json({ error: 'run_id invalide' })

  const { data: run, error: errorRun } = await supabase.from('game_runs').select('party_id').eq('id', run_id).maybeSingle()
  if (errorRun) throw errorRun;
  if (!run) return res.status(404).json({ error: 'Run introuvable' })

  const { data: players, error: errorP } = await supabase
    .from('party_players')
    .select(`
      user_id,
      score,
      profiles:user_id (nom, prenom, avatar_url)
    `)
    .eq('party_id', run.party_id)
    .order('score', { ascending: false })
    .limit(50)

  if (errorP) throw errorP

  const formattedLeaderboard = players?.map((p: any, index: number) => ({
    rank: index + 1,
    user_id: p.user_id,
    score: p.score,
    nom: p.profiles?.nom || 'Joueur',
    prenom: p.profiles?.prenom || 'Anonyme',
    avatar: p.profiles?.avatar_url,
    is_me: p.user_id === userId
  }))

  return res.json({ success: true, leaderboard: formattedLeaderboard || [] })
}
