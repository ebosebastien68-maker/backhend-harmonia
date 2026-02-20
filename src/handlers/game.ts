// =====================================================
// HANDLER GAME - VERSION SÉCURISÉE
// Changements vs version précédente :
//   + listVisibleRuns       → polling frontend (runs is_visible=true)
//   + getQuestions          → lit view_run_questions (correct_answer masqué si run non fermé)
//   + getQuestions          → fonctionne aussi après fermeture (reveal_answers=true via trigger)
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
      case 'listSessions':           return await listSessions(params, res)
      case 'listMySessions':          return await listMySessions(user_id, params, res)
      case 'listAvailableSessions':   return await listAvailableSessions(user_id, params, res)
      case 'listPartiesForSession':  return await listPartiesForSession(user_id, params, res)
      case 'joinSession':            return await joinSession(user_id, params, res)
      case 'listVisibleRuns':        return await listVisibleRuns(user_id, params, res)
      case 'getQuestions':           return await getQuestions(user_id, params, res)
      case 'submitAnswer':           return await submitAnswer(user_id, params, res)
      case 'getLeaderboard':         return await getLeaderboard(user_id, params, res)
      case 'getPartyHistory':        return await getPartyHistory(user_id, params, res)
      case 'getUnansweredQuestions':  return await getUnansweredQuestions(user_id, params, res)
      default:
        return res.status(400).json({ error: `Action inconnue: ${functionName}` })
    }
  } catch (error: any) {
    console.error(`💥 CRASH GAME:`, error)
    return res.status(500).json({ error: 'Erreur serveur', details: error.message })
  }
}


// =====================================================
// LIST MY SESSIONS
// Sessions auxquelles l'utilisateur participe déjà
// (présent dans party_players pour au moins une party)
// =====================================================

async function listMySessions(userId: string, params: any, res: Response) {
  const { game_key } = params
  try {
    // Trouver les sessions via party_players → game_parties → game_sessions
    const { data: myParties, error } = await supabase
      .from('party_players')
      .select(`
        party_id,
        score,
        game_parties!inner (
          session_id,
          game_sessions!inner (
            id, title, description, is_paid, price_cfa, game_key
          )
        )
      `)
      .eq('user_id', userId)

    if (error) throw error

    // Dédupliquer par session_id
    const sessionMap = new Map<string, any>()
    for (const row of myParties || []) {
      const sess = (row as any).game_parties?.game_sessions
      if (!sess) continue
      if (game_key && sess.game_key !== game_key) continue
      if (!sessionMap.has(sess.id)) {
        sessionMap.set(sess.id, {
          id: sess.id,
          title: sess.title,
          description: sess.description,
          is_paid: sess.is_paid,
          price_cfa: sess.price_cfa,
          my_score: (row as any).score ?? 0,
        })
      }
    }

    return res.json({ success: true, sessions: Array.from(sessionMap.values()) })
  } catch (error: any) {
    console.error('ERROR listMySessions:', error)
    return res.status(500).json({ error: 'Erreur mes sessions', details: error.message })
  }
}

// =====================================================
// LIST AVAILABLE SESSIONS
// Sessions disponibles auxquelles l'utilisateur n'est PAS encore inscrit
// =====================================================

async function listAvailableSessions(userId: string, params: any, res: Response) {
  const { game_key } = params
  try {
    // 1. Sessions auxquelles l'utilisateur participe déjà
    const { data: myParties } = await supabase
      .from('party_players')
      .select('game_parties!inner(session_id)')
      .eq('user_id', userId)

    const mySessionIds = new Set<string>(
      (myParties || []).map((p: any) => p.game_parties?.session_id).filter(Boolean)
    )

    // 2. Toutes les sessions du jeu
    const query = supabase
      .from('game_sessions')
      .select('id, title, description, is_paid, price_cfa')
      .order('created_at', { ascending: false })

    if (game_key) query.eq('game_key', game_key as any)

    const { data: allSessions, error } = await query
    if (error) throw error

    // 3. Filtrer celles déjà rejointes
    const available = (allSessions || []).filter(s => !mySessionIds.has(s.id))
    return res.json({ success: true, sessions: available })
  } catch (error: any) {
    console.error('ERROR listAvailableSessions:', error)
    return res.status(500).json({ error: 'Erreur sessions disponibles', details: error.message })
  }
}

// =====================================================
// LIST PARTIES FOR SESSION
// Appelé par le joueur pour choisir son groupe.
// Ne retourne que les infos non-sensibles (pas de correct_answer).
// Filtre les parties existantes pour cette session.
// =====================================================

async function listPartiesForSession(_userId: string, params: any, res: Response) {
  const { session_id } = params

  if (!session_id || !isValidUUID(session_id)) {
    return res.status(400).json({ error: 'session_id invalide' })
  }

  try {
    // Vérifier que la session existe
    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .select('id, title')
      .eq('id', session_id)
      .maybeSingle()

    if (sessionError || !session) {
      return res.status(404).json({ error: 'Session non trouvée' })
    }

    const { data: parties, error } = await supabase
      .from('game_parties')
      .select('id, title, is_initial, min_score, min_rank')
      .eq('session_id', session_id)
      .order('is_initial', { ascending: false }) // party initiale en premier
      .order('created_at', { ascending: true })

    if (error) throw error

    return res.json({ success: true, parties: parties || [] })

  } catch (error: any) {
    console.error('ERROR listPartiesForSession:', error)
    return res.status(500).json({ error: 'Erreur liste groupes', details: error.message })
  }
}



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
// Anti double-débit + utilise party initiale du trigger BDD
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
    // 1. Récupérer la session
    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .select('id, is_paid, price_cfa')
      .eq('id', session_id)
      .maybeSingle()

    if (sessionError || !session) {
      return res.status(404).json({ error: 'Session non trouvée' })
    }

    // 2. Trouver la party cible
    let targetPartyId: string

    if (requestedPartyId) {
      const { data: party, error: partyError } = await supabase
        .from('game_parties')
        .select('id, min_score, min_rank, session_id')
        .eq('id', requestedPartyId)
        .eq('session_id', session_id)
        .maybeSingle()

      if (partyError || !party) {
        return res.status(404).json({ error: 'Party non trouvée pour cette session' })
      }

      // Vérifier min_score
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

      // Vérifier min_rank
      if (party.min_rank !== null) {
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
              error: `Rang minimum requis: top ${party.min_rank}. Votre rang: ${userRank || 'non classé'}`
            })
          }
        }
      }

      targetPartyId = party.id

    } else {
      // Party initiale créée automatiquement par le trigger BDD
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

    // 3. Vérifier si déjà dans la party (anti double-débit)
    const { data: existingPlayer } = await supabase
      .from('party_players')
      .select('id')
      .eq('party_id', targetPartyId)
      .eq('user_id', userId)
      .maybeSingle()

    if (existingPlayer) {
      return res.json({ success: true, message: 'Déjà inscrit dans cette session' })
    }

    // 4. Gestion paiement (seulement si première party de la session)
    if (session.is_paid && session.price_cfa > 0) {
      const sessionPartiesRes = await supabase
        .from('game_parties')
        .select('id')
        .eq('session_id', session_id)

      const sessionPartyIds = sessionPartiesRes.data?.map((p: any) => p.id) || []

      const { data: anyPartyPlayer } = sessionPartyIds.length > 0
        ? await supabase
            .from('party_players')
            .select('id')
            .eq('user_id', userId)
            .in('party_id', sessionPartyIds)
            .maybeSingle()
        : { data: null }

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

    // 5. Ajouter le joueur dans la party
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
// LIST VISIBLE RUNS
// Appelé par le polling frontend toutes les 3s.
// Retourne les runs is_visible=true des parties
// où le joueur est inscrit (pour cette session).
//
// Logique du cycle :
//   is_visible=false → le joueur ne voit rien (waiting)
//   is_visible=true, is_closed=false → question en direct
//   is_visible=true, is_closed=true  → résultats disponibles
// =====================================================

async function listVisibleRuns(userId: string, params: any, res: Response) {
  const { session_id } = params

  if (!session_id || !isValidUUID(session_id)) {
    return res.status(400).json({ error: 'session_id invalide' })
  }

  try {
    // Étape 1 : toutes les parties de la session
    const { data: sessionParties, error: spError } = await supabase
      .from('game_parties')
      .select('id')
      .eq('session_id', session_id)

    if (spError) throw spError

    const allPartyIds = (sessionParties || []).map((p: any) => p.id)
    if (allPartyIds.length === 0) {
      return res.json({ success: true, runs: [] })
    }

    // Étape 2 : parties où le joueur est inscrit
    const { data: playerParties, error: ppError } = await supabase
      .from('party_players')
      .select('party_id')
      .eq('user_id', userId)
      .in('party_id', allPartyIds)

    if (ppError) throw ppError

    const partyIds = (playerParties || []).map((p: any) => p.party_id)
    if (partyIds.length === 0) {
      return res.json({ success: true, runs: [] })
    }

    // Étape 3 : runs visibles (is_visible=true) de ces parties
    const { data: runs, error: runsError } = await supabase
      .from('game_runs')
      .select('id, title, is_visible, is_closed, is_started')
      .in('party_id', partyIds)
      .eq('is_visible', true)
      .order('created_at', { ascending: true })

    if (runsError) throw runsError

    return res.json({ success: true, runs: runs || [] })

  } catch (error: any) {
    console.error('ERROR listVisibleRuns:', error)
    return res.status(500).json({ error: 'Erreur liste runs', details: error.message })
  }
}

// =====================================================
// GET QUESTIONS
// ✅ Lit depuis view_run_questions (vue sécurisée BDD)
//    - Si run non fermé  → correct_answer = NULL (masqué par la vue)
//    - Si run fermé      → correct_answer = true/false (révélé par trigger)
//
// Utilisé dans deux contextes :
//   1. Avant réponse (is_closed=false) → afficher la question sans réponse
//   2. Après fermeture (is_closed=true) → afficher la bonne réponse + score
// =====================================================

async function getQuestions(userId: string, params: any, res: Response) {
  const { run_id } = params

  if (!run_id || !isValidUUID(run_id)) {
    return res.status(400).json({ error: 'run_id invalide' })
  }

  try {
    // Vérifier le run et l'appartenance du joueur
    const { data: run, error: runError } = await supabase
      .from('game_runs')
      .select('is_visible, is_closed, party_id, reveal_answers')
      .eq('id', run_id)
      .maybeSingle()

    if (runError) throw runError
    if (!run) return res.status(404).json({ error: 'Run non trouvé' })

    // Un run non visible n'est accessible qu'après fermeture (pour l'historique)
    // mais le polling ne devrait jamais envoyer un run non visible
    if (!run.is_visible && !run.is_closed) {
      return res.status(403).json({ error: 'Run non visible' })
    }

    // Vérifier que le joueur est bien inscrit dans la party
    const { data: player } = await supabase
      .from('party_players')
      .select('id')
      .eq('party_id', run.party_id)
      .eq('user_id', userId)
      .maybeSingle()

    if (!player) {
      return res.status(403).json({ error: "Rejoignez d'abord la session" })
    }

    // Lire depuis view_run_questions :
    // → correct_answer est NULL si reveal_answers=false (joueur ne peut pas tricher)
    // → correct_answer est true/false si reveal_answers=true (run fermé par trigger)
    const { data: questions, error: qError } = await supabase
      .from('view_run_questions')
      .select('id, question_text, score, correct_answer')
      .eq('run_id', run_id)
      .order('created_at', { ascending: true })

    if (qError) throw qError

    // Récupérer les réponses déjà données par ce joueur
    const { data: answers } = await supabase
      .from('user_run_answers')
      .select('run_question_id, answer, score_awarded')
      .eq('run_id', run_id)
      .eq('user_id', userId)

    const answersMap = new Map(
      (answers || []).map(a => [a.run_question_id, { answer: a.answer, score_awarded: a.score_awarded }])
    )

    const questionsWithStatus = (questions || []).map(q => ({
      id:            q.id,
      question_text: q.question_text,
      score:         q.score,
      correct_answer: q.correct_answer, // null si run pas encore fermé
      answered:      answersMap.has(q.id),
      my_answer:     answersMap.get(q.id)?.answer ?? null,
      score_awarded: answersMap.get(q.id)?.score_awarded ?? null,
    }))

    return res.json({
      success:        true,
      questions:      questionsWithStatus,
      is_closed:      run.is_closed,
      reveal_answers: run.reveal_answers,
    })

  } catch (error: any) {
    console.error('ERROR getQuestions:', error)
    return res.status(500).json({ error: 'Erreur questions', details: error.message })
  }
}

// =====================================================
// SUBMIT ANSWER
// Note : auth.uid() géré côté frontend (Supabase Auth).
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
        return res.status(403).json({ error: 'Run fermé — plus de réponses acceptées' })
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
// Score spécifique au run (user_run_answers.score_awarded)
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
      .select('party_id, is_closed')
      .eq('id', run_id)
      .maybeSingle()

    if (runError) throw runError
    if (!run) return res.status(404).json({ error: 'Run non trouvé' })

    // Scores spécifiques à ce run
    const { data: runScores, error: scoresError } = await supabase
      .from('user_run_answers')
      .select('user_id, score_awarded')
      .eq('run_id', run_id)

    if (scoresError) throw scoresError

    const scoreMap = new Map<string, number>()
    for (const row of runScores || []) {
      scoreMap.set(row.user_id, (scoreMap.get(row.user_id) ?? 0) + row.score_awarded)
    }

    // Joueurs de la party avec profils
    const { data: players, error: playersError } = await supabase
      .from('party_players')
      .select(`
        user_id,
        profiles:user_id (nom, prenom, avatar_url)
      `)
      .eq('party_id', run.party_id)

    if (playersError) throw playersError

    const leaderboard = (players || [])
      .map((p: any) => ({
        user_id:         p.user_id,
        run_score:       scoreMap.get(p.user_id) ?? 0,
        nom:             p.profiles?.nom    || 'Joueur',
        prenom:          p.profiles?.prenom || '',
        avatar_url:      p.profiles?.avatar_url ?? null,
        is_current_user: p.user_id === userId,
      }))
      .sort((a, b) => b.run_score - a.run_score)
      .map((p, index) => ({ rank: index + 1, ...p }))

    return res.json({ success: true, leaderboard, is_closed: run.is_closed })

  } catch (error: any) {
    console.error('ERROR getLeaderboard:', error)
    return res.status(500).json({ error: 'Erreur classement', details: error.message })
  }
}


// =====================================================
// GET UNANSWERED QUESTIONS
// Toutes les questions VISIBLES non encore répondues par l'utilisateur
// dans tous les runs de la party
// =====================================================

async function getUnansweredQuestions(userId: string, params: any, res: Response) {
  const { party_id } = params

  if (!party_id || !isValidUUID(party_id)) {
    return res.status(400).json({ error: 'party_id invalide' })
  }

  try {
    // Runs visibles de cette party
    const { data: runs, error: runsError } = await supabase
      .from('game_runs')
      .select('id, title, is_visible, is_closed')
      .eq('party_id', party_id)
      .eq('is_visible', true)

    if (runsError) throw runsError
    if (!runs || runs.length === 0) {
      return res.json({ success: true, questions: [] })
    }

    const runIds = runs.map((r: any) => r.id)

    // Toutes les questions de ces runs (vue sécurisée)
    const { data: allQs, error: qError } = await supabase
      .from('view_run_questions')
      .select('id, run_id, question_text, score, correct_answer')
      .in('run_id', runIds)

    if (qError) throw qError

    // Réponses déjà soumises par l'utilisateur
    const { data: answers, error: aError } = await supabase
      .from('user_run_answers')
      .select('run_question_id')
      .in('run_id', runIds)
      .eq('user_id', userId)

    if (aError) throw aError

    const answeredIds = new Set((answers || []).map((a: any) => a.run_question_id))

    // Filtrer non-répondues
    // correct_answer est masqué par la vue si le run n'est pas fermé
    const unanswered = (allQs || [])
      .filter((q: any) => !answeredIds.has(q.id))
      .map((q: any) => ({
        id: q.id,
        run_id: q.run_id,
        question_text: q.question_text,
        score: q.score,
        correct_answer: null, // masqué avant révélation
        answered: false,
        my_answer: null,
        score_awarded: null,
      }))

    return res.json({ success: true, questions: unanswered })

  } catch (error: any) {
    console.error('ERROR getUnansweredQuestions:', error)
    return res.status(500).json({ error: 'Erreur questions non-répondues', details: error.message })
  }
}

// =====================================================
// GET PARTY HISTORY
// Retourne toutes les questions fermées (reveal_answers=true)
// de la party, avec la réponse de l'utilisateur et le score total
// =====================================================

async function getPartyHistory(userId: string, params: any, res: Response) {
  const { party_id } = params

  if (!party_id || !isValidUUID(party_id)) {
    return res.status(400).json({ error: 'party_id invalide' })
  }

  try {
    // Score total de l'utilisateur dans cette party
    const { data: playerData } = await supabase
      .from('party_players')
      .select('score')
      .eq('party_id', party_id)
      .eq('user_id', userId)
      .maybeSingle()

    const totalScore = playerData?.score ?? null // null = pas encore inscrit

    // Tous les runs fermés de cette party
    const { data: runs, error: runsError } = await supabase
      .from('game_runs')
      .select('id, title, is_closed, reveal_answers')
      .eq('party_id', party_id)
      .eq('is_closed', true)
      .eq('reveal_answers', true)
      .order('created_at', { ascending: true })

    if (runsError) throw runsError
    if (!runs || runs.length === 0) {
      return res.json({ success: true, history: [], total_score: totalScore, is_member: totalScore !== null })
    }

    const runIds = runs.map((r: any) => r.id)

    // Guard: si aucun run, retourner vide
    if (runIds.length === 0) {
      return res.json({ success: true, history: [], total_score: totalScore, is_member: totalScore !== null })
    }

    // Toutes les questions de ces runs
    let questions: any[] = []
    let answers: any[] = []

    try {
      const qRes = await supabase
        .from('run_questions')
        .select('id, run_id, question_text, correct_answer, score')
        .in('run_id', runIds)
      if (qRes.error) throw qRes.error
      questions = qRes.data || []
    } catch (e: any) {
      console.error('getPartyHistory questions error:', e.message)
      // Continuer avec questions vides plutôt que planter
    }

    try {
      const aRes = await supabase
        .from('user_run_answers')
        .select('run_question_id, answer, score_awarded')
        .in('run_id', runIds)
        .eq('user_id', userId)
      if (aRes.error) throw aRes.error
      answers = aRes.data || []
    } catch (e: any) {
      console.error('getPartyHistory answers error:', e.message)
    }

    const answerMap = new Map<string, { answer: boolean; score_awarded: number }>(
      (answers || []).map((a: any) => [a.run_question_id, { answer: a.answer, score_awarded: a.score_awarded }])
    )

    // Grouper questions par run
    const runMap = new Map((runs || []).map((r: any) => [r.id, { ...r, questions: [] as any[] }]))

    for (const q of questions || []) {
      const myAnswer = answerMap.get(q.id)
      const entry = {
        id:            q.id,
        question_text: q.question_text,
        correct_answer: q.correct_answer,
        score:         q.score,
        my_answer:     myAnswer?.answer ?? null,
        score_awarded: myAnswer?.score_awarded ?? null,
        answered:      !!myAnswer,
      }
      const run = runMap.get(q.run_id)
      if (run) run.questions.push(entry)
    }

    const history = Array.from(runMap.values()).map(r => ({
      run_id:    r.id,
      run_title: r.title,
      questions: r.questions,
    }))

    return res.json({
      success:     true,
      history,
      total_score: totalScore,
      is_member:   totalScore !== null,
    })

  } catch (error: any) {
    console.error('ERROR getPartyHistory:', error)
    return res.status(500).json({ error: 'Erreur historique', details: error.message })
  }
}
