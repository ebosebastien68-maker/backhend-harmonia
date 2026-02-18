// =====================================================
// HANDLER GAME - VERSION MISE À JOUR
// =====================================================

import { Request, Response } from 'express'
import supabase from '../config/supabase'

const isValidUUID = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

export async function handleGame(req: Request, res: Response) {
  const { function: functionName, user_id, ...params } = req.body

  console.log(`[${new Date().toISOString()}] 🎮 Game: ${functionName} | User: ${user_id || 'Public'}`)

  if (functionName !== 'listSessions' && !user_id) {
    return res.status(401).json({ error: 'user_id requis' })
  }

  if (user_id && !isValidUUID(user_id)) {
    return res.status(400).json({ error: 'user_id invalide' })
  }

  try {
    switch (functionName) {
      case 'listSessions':   return await listSessions(params, res)
      case 'joinSession':    return await joinSession(user_id, params, res)
      case 'getQuestions':   return await getQuestions(user_id, params, res)
      case 'submitAnswer':   return await submitAnswer(user_id, params, res)
      case 'getLeaderboard': return await getLeaderboard(user_id, params, res)
      default:
        return res.status(400).json({ error: `Action inconnue: ${functionName}` })
    }
  } catch (error: any) {
    console.error(`💥 CRASH GAME:`, error)
    return res.status(500).json({ error: 'Erreur serveur', details: error.message })
  }
}

// =====================================================
// LIST SESSIONS
// =====================================================

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

    if (!game) return res.status(404).json({ error: 'Jeu non trouvé' })

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

// =====================================================
// JOIN SESSION
// Corrections :
//   1. Anti double-débit : vérifier si déjà dans la party avant de payer
//   2. Utiliser la party initiale créée par le trigger BDD (is_initial = true)
//   3. Vérifier min_score / min_rank pour les parties non-initiales
// =====================================================

async function joinSession(userId: string, params: any, res: Response) {
  const { session_id, party_id: requestedPartyId } = params

  if (!session_id || !isValidUUID(session_id)) {
    return res.status(400).json({ error: 'session_id invalide' })
  }

  if (requestedPartyId && !isValidUUID(requestedPartyId)) {
    return res.status(400).json({ error: 'party_id invalide' })
  }

  try {
    // --- 1. Récupérer la session ---
    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .select('id, is_paid, price_cfa')
      .eq('id', session_id)
      .maybeSingle()

    if (sessionError || !session) {
      return res.status(404).json({ error: 'Session non trouvée' })
    }

    // --- 2. Trouver la party cible (initiale ou demandée) ---
    let targetPartyId: string

    if (requestedPartyId) {
      // Party spécifique demandée → vérifier min_score / min_rank
      const { data: party, error: partyError } = await supabase
        .from('game_parties')
        .select('id, min_score, min_rank, session_id')
        .eq('id', requestedPartyId)
        .eq('session_id', session_id)
        .maybeSingle()

      if (partyError || !party) {
        return res.status(404).json({ error: 'Party non trouvée pour cette session' })
      }

      // Vérifier min_score si défini
      if (party.min_score !== null && party.min_score > 0) {
        const { data: playerStats } = await supabase
          .from('party_players')
          .select('score')
          .eq('user_id', userId)
          .order('score', { ascending: false })
          .limit(1)
          .maybeSingle()

        const userBestScore = playerStats?.score ?? 0
        if (userBestScore < party.min_score) {
          return res.status(403).json({
            error: `Score minimum requis: ${party.min_score}. Votre meilleur score: ${userBestScore}`
          })
        }
      }

      // Vérifier min_rank si défini
      if (party.min_rank !== null) {
        // Rang dans la party initiale de cette session
        const { data: initialParty } = await supabase
          .from('game_parties')
          .select('id')
          .eq('session_id', session_id)
          .eq('is_initial', true)
          .maybeSingle()

        if (initialParty) {
          const { data: rankedPlayers } = await supabase
            .from('party_players')
            .select('user_id, score')
            .eq('party_id', initialParty.id)
            .order('score', { ascending: false })

          const userRank = (rankedPlayers || []).findIndex(p => p.user_id === userId) + 1
          if (userRank === 0 || userRank > party.min_rank) {
            return res.status(403).json({
              error: `Rang minimum requis: top ${party.min_rank}. Votre rang actuel: ${userRank || 'non classé'}`
            })
          }
        }
      }

      targetPartyId = party.id

    } else {
      // Utiliser la party initiale créée par le trigger BDD
      const { data: initialParty, error: initError } = await supabase
        .from('game_parties')
        .select('id')
        .eq('session_id', session_id)
        .eq('is_initial', true)
        .maybeSingle()

      if (initError || !initialParty) {
        return res.status(500).json({ error: 'Party initiale introuvable pour cette session' })
      }

      targetPartyId = initialParty.id
    }

    // --- 3. Vérifier si déjà dans la party (anti double-débit) ---
    const { data: existingPlayer } = await supabase
      .from('party_players')
      .select('id')
      .eq('party_id', targetPartyId)
      .eq('user_id', userId)
      .maybeSingle()

    if (existingPlayer) {
      return res.json({ success: true, message: 'Déjà inscrit dans cette party' })
    }

    // --- 4. Gestion paiement (seulement si pas encore dans la session) ---
    if (session.is_paid && session.price_cfa > 0) {
      // Vérifier si l'utilisateur est déjà dans n'importe quelle party de cette session
      const { data: anyPartyPlayer } = await supabase
        .from('party_players')
        .select('id')
        .eq('user_id', userId)
        .in(
          'party_id',
          (
            await supabase
              .from('game_parties')
              .select('id')
              .eq('session_id', session_id)
          ).data?.map((p: any) => p.id) || []
        )
        .maybeSingle()

      // Ne débiter que si c'est la première party de cette session
      if (!anyPartyPlayer) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('solde_cfa')
          .eq('id', userId)
          .single()

        if (!profile || profile.solde_cfa < session.price_cfa) {
          return res.status(400).json({
            error: 'Solde insuffisant',
            solde: profile?.solde_cfa ?? 0,
            prix: session.price_cfa
          })
        }

        const { error: debitError } = await supabase
          .from('profiles')
          .update({ solde_cfa: profile.solde_cfa - session.price_cfa })
          .eq('id', userId)

        if (debitError) throw debitError
      }
    }

    // --- 5. Ajouter le joueur dans la party ---
    const { error: playerError } = await supabase
      .from('party_players')
      .insert({ party_id: targetPartyId, user_id: userId, score: 0 })

    if (playerError && !playerError.message.includes('duplicate')) {
      throw playerError
    }

    return res.json({ success: true, message: 'Session rejointe', party_id: targetPartyId })

  } catch (error: any) {
    console.error('ERROR joinSession:', error)
    return res.status(500).json({ error: 'Erreur rejoindre session', details: error.message })
  }
}

// =====================================================
// GET QUESTIONS
// =====================================================

async function getQuestions(userId: string, params: any, res: Response) {
  const { run_id } = params

  if (!run_id || !isValidUUID(run_id)) {
    return res.status(400).json({ error: 'run_id invalide' })
  }

  try {
    const { data: run, error: runError } = await supabase
      .from('game_runs')
      .select('is_visible, is_closed, party_id')
      .eq('id', run_id)
      .maybeSingle()

    if (runError) throw runError
    if (!run) return res.status(404).json({ error: 'Run non trouvé' })
    if (!run.is_visible) return res.status(403).json({ error: 'Run non visible' })
    if (run.is_closed) return res.status(403).json({ error: 'Run fermé' })

    const { data: player } = await supabase
      .from('party_players')
      .select('id')
      .eq('party_id', run.party_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!player) {
      return res.status(403).json({ error: "Rejoignez d'abord la session" })
    }

    const { data: questions, error: qError } = await supabase
      .from('run_questions')
      .select('id, question_text, score')
      .eq('run_id', run_id)
      .order('created_at', { ascending: true })

    if (qError) throw qError

    const { data: answers } = await supabase
      .from('user_run_answers')
      .select('run_question_id')
      .eq('run_id', run_id)
      .eq('user_id', userId)

    const answeredIds = new Set(answers?.map((a) => a.run_question_id) || [])

    const questionsWithStatus = questions?.map((q) => ({
      ...q,
      answered: answeredIds.has(q.id)
    }))

    return res.json({ success: true, questions: questionsWithStatus || [] })

  } catch (error: any) {
    console.error('ERROR getQuestions:', error)
    return res.status(500).json({ error: 'Erreur questions', details: error.message })
  }
}

// =====================================================
// SUBMIT ANSWER
// Note : auth.uid() est géré côté frontend (Supabase Auth).
// Le backend appelle la RPC avec le service role ; la RPC elle-même
// utilise auth.uid() qui sera NULL ici → cette fonction est intentionnellement
// déléguée au frontend. Ce handler reste pour compatibilité ou usage admin.
// =====================================================

async function submitAnswer(_userId: string, params: any, res: Response) {
  const { run_question_id, answer } = params

  if (!run_question_id || typeof answer !== 'boolean') {
    return res.status(400).json({ error: 'run_question_id et answer (boolean) requis' })
  }

  try {
    const { error } = await supabase.rpc('submit_answer', {
      p_run_question_id: run_question_id,
      p_answer: answer
    })

    if (error) {
      if (error.message.includes('already answered')) {
        return res.status(400).json({ error: 'Déjà répondu à cette question' })
      }
      if (error.message.includes('closed')) {
        return res.status(403).json({ error: 'Run fermé' })
      }
      if (error.message.includes('not participant')) {
        return res.status(403).json({ error: "Vous n'êtes pas participant de cette party" })
      }
      throw error
    }

    return res.json({ success: true, message: 'Réponse enregistrée' })

  } catch (error: any) {
    console.error('ERROR submitAnswer:', error)
    return res.status(500).json({ error: 'Erreur réponse', details: error.message })
  }
}

// =====================================================
// GET LEADERBOARD
// Score spécifique au run (agréger user_run_answers pour ce run)
// et non le score cumulé de la party
// =====================================================

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

    // Récupérer les scores spécifiques à ce run
    const { data: runScores, error: scoresError } = await supabase
      .from('user_run_answers')
      .select('user_id, score_awarded')
      .eq('run_id', run_id)

    if (scoresError) throw scoresError

    // Agréger les scores par user pour ce run
    const scoreMap = new Map<string, number>()
    for (const row of runScores || []) {
      scoreMap.set(row.user_id, (scoreMap.get(row.user_id) ?? 0) + row.score_awarded)
    }

    // Récupérer les joueurs de la party avec leurs profils
    const { data: players, error: playersError } = await supabase
      .from('party_players')
      .select(`
        user_id,
        profiles:user_id (nom, prenom, avatar_url)
      `)
      .eq('party_id', run.party_id)

    if (playersError) throw playersError

    // Construire et trier le leaderboard par score run
    const leaderboard = (players || [])
      .map((p: any) => ({
        user_id: p.user_id,
        run_score: scoreMap.get(p.user_id) ?? 0,
        nom: p.profiles?.nom || 'Joueur',
        prenom: p.profiles?.prenom || '',
        avatar_url: p.profiles?.avatar_url ?? null,
        is_current_user: p.user_id === userId
      }))
      .sort((a, b) => b.run_score - a.run_score)
      .map((p, index) => ({ rank: index + 1, ...p }))

    return res.json({ success: true, leaderboard })

  } catch (error: any) {
    console.error('ERROR getLeaderboard:', error)
    return res.status(500).json({ error: 'Erreur classement', details: error.message })
  }
}
