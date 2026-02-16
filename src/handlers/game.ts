// =====================================================
// HANDLER GAME - FONCTIONS JOUEURS
// =====================================================

import { Request, Response } from 'express'
import supabase from '../config/supabase'

export async function handleGame(req: Request, res: Response) {
  const { function: functionName, user_id, ...params } = req.body

  console.log(`[${new Date().toISOString()}] game/${functionName}`)

  if (functionName !== 'listSessions' && !user_id) {
    return res.status(401).json({
      error: 'user_id requis',
      timestamp: new Date().toISOString()
    })
  }

  try {
    switch (functionName) {
      case 'listSessions':
        return await listSessions(params, res)
      case 'joinSession':
        return await joinSession(user_id, params, res)
      case 'getQuestions':
        return await getQuestions(user_id, params, res)
      case 'submitAnswer':
        return await submitAnswer(user_id, params, res)
      case 'getLeaderboard':
        return await getLeaderboard(user_id, params, res)
      default:
        return res.status(400).json({
          error: 'Fonction inconnue',
          available: ['listSessions', 'joinSession', 'getQuestions', 'submitAnswer', 'getLeaderboard'],
          timestamp: new Date().toISOString()
        })
    }
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ERROR:`, error)
    return res.status(500).json({
      error: 'Erreur serveur',
      details: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

async function listSessions(params: any, res: Response) {
  try {
    const { game_key } = params
    if (!game_key) return res.status(400).json({ error: 'game_key requis' })

    const { data: game } = await supabase.from('games').select('id').eq('key_name', game_key).single()
    if (!game) return res.status(404).json({ error: 'Jeu non trouvé' })

    const { data: sessions } = await supabase
      .from('game_sessions')
      .select('id, title, description, is_paid, price_cfa, created_at')
      .eq('game_id', game.id)
      .order('created_at', { ascending: false })

    return res.json({ success: true, sessions: sessions || [], timestamp: new Date().toISOString() })
  } catch (error: any) {
    return res.status(500).json({ error: 'Erreur', details: error.message })
  }
}

async function joinSession(_userId: string, params: any, res: Response) {
  try {
    const { session_id } = params
    if (!session_id) return res.status(400).json({ error: 'session_id requis' })

    const { error } = await supabase.rpc('join_session', { p_session_id: session_id })
    if (error) {
      if (error.message.includes('Insufficient')) {
        return res.status(400).json({ error: 'Solde insuffisant' })
      }
      throw error
    }

    return res.json({ success: true, message: 'Session rejointe', timestamp: new Date().toISOString() })
  } catch (error: any) {
    return res.status(500).json({ error: 'Erreur', details: error.message })
  }
}

async function getQuestions(userId: string, params: any, res: Response) {
  try {
    const { run_id } = params
    if (!run_id) return res.status(400).json({ error: 'run_id requis' })

    const { data: run } = await supabase
      .from('game_runs')
      .select('is_visible, is_closed, party_id')
      .eq('id', run_id)
      .single()

    if (!run?.is_visible) return res.status(403).json({ error: 'Run non disponible' })
    if (run.is_closed) return res.status(403).json({ error: 'Run fermé' })

    const { data: questions } = await supabase
      .from('run_questions')
      .select('id, question_text, score')
      .eq('run_id', run_id)
      .order('created_at')

    const { data: userAnswers } = await supabase
      .from('user_run_answers')
      .select('run_question_id, answer, score_awarded')
      .eq('run_id', run_id)
      .eq('user_id', userId)

    const questionsWithStatus = questions?.map(q => ({
      ...q,
      answered: userAnswers?.some(a => a.run_question_id === q.id) || false
    }))

    return res.json({ success: true, questions: questionsWithStatus || [], timestamp: new Date().toISOString() })
  } catch (error: any) {
    return res.status(500).json({ error: 'Erreur', details: error.message })
  }
}

async function submitAnswer(_userId: string, params: any, res: Response) {
  try {
    const { run_question_id, answer } = params
    if (!run_question_id || typeof answer !== 'boolean') {
      return res.status(400).json({ error: 'run_question_id et answer requis' })
    }

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

    return res.json({ success: true, message: 'Réponse enregistrée', timestamp: new Date().toISOString() })
  } catch (error: any) {
    return res.status(500).json({ error: 'Erreur', details: error.message })
  }
}

async function getLeaderboard(userId: string, params: any, res: Response) {
  try {
    const { run_id } = params
    if (!run_id) return res.status(400).json({ error: 'run_id requis' })

    const { data: run } = await supabase.from('game_runs').select('party_id').eq('id', run_id).single()
    if (!run) return res.status(404).json({ error: 'Run non trouvé' })

    const { data: leaderboard } = await supabase
      .from('party_players')
      .select('user_id, score, profiles(nom, prenom, avatar_url)')
      .eq('party_id', run.party_id)
      .order('score', { ascending: false })

    const leaderboardWithRank = leaderboard?.map((player, index) => {
      const profile = player.profiles as any
      return {
        rank: index + 1,
        user_id: player.user_id,
        score: player.score,
        nom: profile?.nom || '',
        prenom: profile?.prenom || '',
        avatar_url: profile?.avatar_url || null,
        is_current_user: player.user_id === userId
      }
    })

    return res.json({ success: true, leaderboard: leaderboardWithRank || [], timestamp: new Date().toISOString() })
  } catch (error: any) {
    return res.status(500).json({ error: 'Erreur', details: error.message })
  }
}
