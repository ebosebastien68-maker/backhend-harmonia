// =====================================================
// HANDLER GAME — COMPLET ET SÉCURISÉ
// CLÉ ANON UNIQUEMENT → RLS Supabase actif
//
// ROUTES UTILISATEUR (4 onglets) :
//   listMySessions          → onglet 1 : sessions rejointes
//   listAvailableSessions   → onglet 2 : sessions à explorer
//   joinSession             → rejoindre une session/party
//   listPartiesForSession   → groupes d'une session
//   getUnansweredQuestions  → questions à répondre
//   submitAnswer            → soumettre une réponse
//   getMyAnswers            → onglet 3 : mes réponses (sans score)
//   getMyResults            → onglet 4 : résultats (si révélés par admin)
//
// ROUTES CONSULTATION (présentes dans l'app) :
//   listSessions            → liste générale de sessions
//   listVisibleRuns         → runs visibles d'une party (polling)
//   getQuestions            → questions d'un run
//   getLeaderboard          → classement d'un run
//   getPartyHistory         → historique complet d'une party (révélé)
//
// SÉCURITÉ SCORES :
//   correct_answer jamais retourné avant reveal_answers=true
//   score_awarded jamais retourné avant reveal_answers=true
//   submitAnswer retourne uniquement { success: true }
// =====================================================

import { Request, Response } from 'express'
import supabase from '../config/supabase'  // CLÉ ANON — RLS ACTIF

const isValidUUID = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

export async function handleGame(req: Request, res: Response) {
  const { function: fn, user_id, ...params } = req.body

  console.log(`[${new Date().toISOString()}] Game: ${fn} | user: ${user_id ?? '?'}`)

  if (!user_id)              return res.status(401).json({ error: 'user_id requis' })
  if (!isValidUUID(user_id)) return res.status(400).json({ error: 'user_id invalide' })

  try {
    switch (fn) {
      // ── Onglets utilisateur ──────────────────────────────
      case 'listMySessions':         return await listMySessions(user_id, params, res)
      case 'listAvailableSessions':  return await listAvailableSessions(user_id, params, res)
      case 'joinSession':            return await joinSession(user_id, params, res)
      case 'listPartiesForSession':  return await listPartiesForSession(user_id, params, res)
      case 'getUnansweredQuestions': return await getUnansweredQuestions(user_id, params, res)
      case 'submitAnswer':           return await submitAnswer(user_id, params, res)
      case 'getMyAnswers':           return await getMyAnswers(user_id, params, res)
      case 'getMyResults':           return await getMyResults(user_id, params, res)
      // ── Routes générales / consultation ─────────────────
      case 'listSessions':           return await listSessions(params, res)
      case 'listVisibleRuns':        return await listVisibleRuns(user_id, params, res)
      case 'getQuestions':           return await getQuestions(user_id, params, res)
      case 'getLeaderboard':         return await getLeaderboard(user_id, params, res)
      case 'getPartyHistory':        return await getPartyHistory(user_id, params, res)
      default:
        return res.status(400).json({ error: `Action inconnue: ${fn}` })
    }
  } catch (err: any) {
    console.error('CRASH GAME:', err)
    return res.status(500).json({ error: 'Erreur serveur', details: err.message })
  }
}

// =====================================================
// ONGLET 1 — MES SESSIONS
// Sessions auxquelles l'utilisateur est déjà inscrit
// =====================================================

async function listMySessions(userId: string, params: any, res: Response) {
  const { game_key } = params
  try {
    // Étape 1 : parties où l'utilisateur est inscrit
    const { data: myParties, error: e1 } = await supabase
      .from('party_players')
      .select('party_id, score')
      .eq('user_id', userId)

    if (e1) throw e1
    if (!myParties || myParties.length === 0)
      return res.json({ success: true, sessions: [] })

    const partyIds = myParties.map((p: any) => p.party_id)

    // Étape 2 : session_id de chaque party
    const { data: partiesData, error: e2 } = await supabase
      .from('game_parties')
      .select('id, session_id')
      .in('id', partyIds)

    if (e2) throw e2

    const sessionIds = [...new Set(
      (partiesData || []).map((p: any) => p.session_id).filter(Boolean)
    )]
    if (sessionIds.length === 0) return res.json({ success: true, sessions: [] })

    // Étape 3 : détails des sessions
    const { data: sessions, error: e3 } = await supabase
      .from('game_sessions')
      .select('id, title, description, is_paid, price_cfa, game_id')
      .in('id', sessionIds)

    if (e3) throw e3

    // Filtrer par game_key si fourni
    let filtered = sessions || []
    if (game_key) {
      const { data: game } = await supabase
        .from('games').select('id').eq('key_name', game_key).maybeSingle()
      if (game) filtered = filtered.filter((s: any) => s.game_id === game.id)
    }

    // Score max par session
    const scoreMap = new Map<string, number>()
    for (const mp of myParties) {
      const party = (partiesData || []).find((p: any) => p.id === mp.party_id)
      if (!party) continue
      const cur = scoreMap.get(party.session_id) ?? 0
      scoreMap.set(party.session_id, Math.max(cur, mp.score ?? 0))
    }

    return res.json({
      success: true,
      sessions: filtered.map((s: any) => ({
        id: s.id, title: s.title, description: s.description,
        is_paid: s.is_paid, price_cfa: s.price_cfa,
        my_score: scoreMap.get(s.id) ?? 0,
      }))
    })
  } catch (err: any) {
    console.error('ERROR listMySessions:', err)
    return res.status(500).json({ error: 'Erreur mes sessions', details: err.message })
  }
}

// =====================================================
// ONGLET 2 — EXPLORER
// Sessions disponibles non encore rejointes
// =====================================================

async function listAvailableSessions(userId: string, params: any, res: Response) {
  const { game_key } = params
  try {
    const { data: myParties } = await supabase
      .from('party_players')
      .select('game_parties!inner(session_id)')
      .eq('user_id', userId)

    const mySessionIds = new Set<string>()
    for (const mp of myParties || []) {
      const sid = (mp as any).game_parties?.session_id
      if (sid) mySessionIds.add(sid)
    }

    let gameId: string | null = null
    if (game_key) {
      const { data: game } = await supabase
        .from('games').select('id').eq('key_name', game_key).maybeSingle()
      gameId = game?.id ?? null
    }

    let query = supabase
      .from('game_sessions')
      .select('id, title, description, is_paid, price_cfa')
      .order('created_at', { ascending: false })
    if (gameId) query = query.eq('game_id', gameId) as any

    const { data: allSessions, error } = await query
    if (error) throw error

    return res.json({
      success: true,
      sessions: (allSessions || []).filter((s: any) => !mySessionIds.has(s.id))
    })
  } catch (err: any) {
    console.error('ERROR listAvailableSessions:', err)
    return res.status(500).json({ error: 'Erreur sessions disponibles', details: err.message })
  }
}

// =====================================================
// LIST SESSIONS (route générale — sans filtre utilisateur)
// =====================================================

async function listSessions(params: any, res: Response) {
  const { game_key, session_id } = params
  try {
    if (session_id) {
      if (!isValidUUID(session_id))
        return res.status(400).json({ error: 'session_id invalide' })
      const { data, error } = await supabase
        .from('game_sessions')
        .select('id, title, description, is_paid, price_cfa')
        .eq('id', session_id)
        .maybeSingle()
      if (error) throw error
      return res.json({ success: true, session: data })
    }

    let gameId: string | null = null
    if (game_key) {
      const { data: game } = await supabase
        .from('games').select('id').eq('key_name', game_key).maybeSingle()
      gameId = game?.id ?? null
    }

    let query = supabase
      .from('game_sessions')
      .select('id, title, description, is_paid, price_cfa')
      .order('created_at', { ascending: false })
    if (gameId) query = query.eq('game_id', gameId) as any

    const { data, error } = await query
    if (error) throw error
    return res.json({ success: true, sessions: data || [] })
  } catch (err: any) {
    console.error('ERROR listSessions:', err)
    return res.status(500).json({ error: 'Erreur sessions', details: err.message })
  }
}

// =====================================================
// JOIN SESSION
// =====================================================

async function joinSession(userId: string, params: any, res: Response) {
  const { session_id, party_id: requestedPartyId } = params

  if (!session_id || !isValidUUID(session_id))
    return res.status(400).json({ error: 'session_id invalide' })
  if (requestedPartyId && !isValidUUID(requestedPartyId))
    return res.status(400).json({ error: 'party_id invalide' })

  try {
    const { data: session } = await supabase
      .from('game_sessions').select('id, is_paid, price_cfa')
      .eq('id', session_id).maybeSingle()
    if (!session) return res.status(404).json({ error: 'Session non trouvée' })

    let targetPartyId: string

    if (requestedPartyId) {
      const { data: party } = await supabase
        .from('game_parties').select('id, min_score, is_initial')
        .eq('id', requestedPartyId).eq('session_id', session_id).maybeSingle()
      if (!party) return res.status(404).json({ error: 'Groupe non trouvé' })

      if (!party.is_initial && party.min_score > 0) {
        const { data: sessionParties } = await supabase
          .from('game_parties').select('id').eq('session_id', session_id)
        const { data: myPlayer } = await supabase
          .from('party_players').select('score').eq('user_id', userId)
          .in('party_id', (sessionParties || []).map((p: any) => p.id))
          .order('score', { ascending: false }).limit(1).maybeSingle()
        if ((myPlayer?.score ?? 0) < party.min_score)
          return res.status(403).json({
            error: `Score insuffisant. Requis : ${party.min_score} pts. Votre score : ${myPlayer?.score ?? 0} pts`
          })
      }
      targetPartyId = party.id
    } else {
      const { data: initialParty } = await supabase
        .from('game_parties').select('id')
        .eq('session_id', session_id).eq('is_initial', true).maybeSingle()
      if (!initialParty) return res.status(500).json({ error: 'Groupe initial introuvable' })
      targetPartyId = initialParty.id
    }

    const { data: existing } = await supabase
      .from('party_players').select('id')
      .eq('party_id', targetPartyId).eq('user_id', userId).maybeSingle()
    if (existing)
      return res.json({ success: true, message: 'Déjà inscrit', party_id: targetPartyId })

    if (session.is_paid && session.price_cfa > 0) {
      const { data: sessionParties } = await supabase
        .from('game_parties').select('id').eq('session_id', session_id)
      const { data: anyExisting } = await supabase
        .from('party_players').select('id').eq('user_id', userId)
        .in('party_id', (sessionParties || []).map((p: any) => p.id)).maybeSingle()
      if (!anyExisting) {
        const { data: profile } = await supabase
          .from('profiles').select('solde_cfa').eq('id', userId).single()
        if (!profile || profile.solde_cfa < session.price_cfa)
          return res.status(400).json({
            error: 'Solde insuffisant', solde: profile?.solde_cfa ?? 0, prix: session.price_cfa
          })
        await supabase.from('profiles')
          .update({ solde_cfa: profile.solde_cfa - session.price_cfa }).eq('id', userId)
      }
    }

    const { error: insertError } = await supabase
      .from('party_players').insert({ party_id: targetPartyId, user_id: userId, score: 0 })
    if (insertError && !insertError.message.includes('duplicate')) throw insertError

    return res.json({ success: true, message: 'Session rejointe', party_id: targetPartyId })
  } catch (err: any) {
    console.error('ERROR joinSession:', err)
    return res.status(500).json({ error: 'Erreur joinSession', details: err.message })
  }
}

// =====================================================
// LIST PARTIES FOR SESSION
// =====================================================

async function listPartiesForSession(userId: string, params: any, res: Response) {
  void userId; // non utilisé — requis pour cohérence du switch
  const { session_id } = params
  if (!session_id || !isValidUUID(session_id))
    return res.status(400).json({ error: 'session_id invalide' })
  try {
    const { data: parties, error } = await supabase
      .from('game_parties')
      .select('id, title, is_initial, min_score, min_rank')
      .eq('session_id', session_id)
      .order('created_at', { ascending: true })
    if (error) throw error
    return res.json({ success: true, parties: parties || [] })
  } catch (err: any) {
    console.error('ERROR listPartiesForSession:', err)
    return res.status(500).json({ error: 'Erreur groupes', details: err.message })
  }
}

// =====================================================
// LIST VISIBLE RUNS (polling frontend)
// =====================================================

async function listVisibleRuns(userId: string, params: any, res: Response) {
  const { party_id } = params
  if (!party_id || !isValidUUID(party_id))
    return res.status(400).json({ error: 'party_id invalide' })
  try {
    const { data: player } = await supabase
      .from('party_players').select('id')
      .eq('party_id', party_id).eq('user_id', userId).maybeSingle()
    if (!player) return res.status(403).json({ error: "Rejoignez d'abord la session" })

    const { data: runs, error } = await supabase
      .from('game_runs')
      .select('id, title, is_visible, is_closed, is_started')
      .eq('party_id', party_id)
      .eq('is_visible', true)
      .order('created_at', { ascending: true })
    if (error) throw error
    return res.json({ success: true, runs: runs || [] })
  } catch (err: any) {
    console.error('ERROR listVisibleRuns:', err)
    return res.status(500).json({ error: 'Erreur runs', details: err.message })
  }
}

// =====================================================
// GET UNANSWERED QUESTIONS
// Questions non encore répondues dans les runs ouverts
// ⚠️  correct_answer JAMAIS retourné ici
// =====================================================

async function getUnansweredQuestions(userId: string, params: any, res: Response) {
  const { party_id } = params
  if (!party_id || !isValidUUID(party_id))
    return res.status(400).json({ error: 'party_id invalide' })
  try {
    const { data: player } = await supabase
      .from('party_players').select('id')
      .eq('party_id', party_id).eq('user_id', userId).maybeSingle()
    if (!player) return res.status(403).json({ error: "Rejoignez d'abord la session" })

    const { data: runs } = await supabase
      .from('game_runs').select('id')
      .eq('party_id', party_id).eq('is_visible', true).eq('is_closed', false)
    if (!runs || runs.length === 0)
      return res.json({ success: true, questions: [] })

    const runIds = runs.map((r: any) => r.id)

    // id, question_text, score UNIQUEMENT — correct_answer absent
    const { data: allQs, error: qErr } = await supabase
      .from('run_questions')
      .select('id, run_id, question_text, score')
      .in('run_id', runIds)
    if (qErr) throw qErr

    const { data: answers } = await supabase
      .from('user_run_answers').select('run_question_id')
      .in('run_id', runIds).eq('user_id', userId)

    const answeredIds = new Set((answers || []).map((a: any) => a.run_question_id))

    return res.json({
      success: true,
      questions: (allQs || [])
        .filter((q: any) => !answeredIds.has(q.id))
        .map((q: any) => ({
          id: q.id, run_id: q.run_id,
          question_text: q.question_text, score: q.score
          // correct_answer : JAMAIS ICI
        }))
    })
  } catch (err: any) {
    console.error('ERROR getUnansweredQuestions:', err)
    return res.status(500).json({ error: 'Erreur questions', details: err.message })
  }
}

// =====================================================
// GET QUESTIONS (d'un run spécifique)
// Vue sécurisée — correct_answer masqué si run non fermé
// =====================================================

async function getQuestions(userId: string, params: any, res: Response) {
  const { run_id } = params
  if (!run_id || !isValidUUID(run_id))
    return res.status(400).json({ error: 'run_id invalide' })
  try {
    const { data: run, error: runError } = await supabase
      .from('game_runs')
      .select('is_visible, is_closed, party_id, reveal_answers')
      .eq('id', run_id).maybeSingle()
    if (runError) throw runError
    if (!run) return res.status(404).json({ error: 'Run non trouvé' })
    if (!run.is_visible && !run.is_closed)
      return res.status(403).json({ error: 'Run non visible' })

    const { data: player } = await supabase
      .from('party_players').select('id')
      .eq('party_id', run.party_id).eq('user_id', userId).maybeSingle()
    if (!player)
      return res.status(403).json({ error: "Rejoignez d'abord la session" })

    // Vue sécurisée : correct_answer null si reveal_answers=false
    const { data: questions, error: qError } = await supabase
      .from('view_run_questions')
      .select('id, question_text, score, correct_answer')
      .eq('run_id', run_id)
      .order('created_at', { ascending: true })
    if (qError) throw qError

    const { data: answers } = await supabase
      .from('user_run_answers').select('run_question_id, answer, score_awarded')
      .eq('run_id', run_id).eq('user_id', userId)

    const answerMap = new Map((answers || []).map((a: any) => [a.run_question_id, a]))

    return res.json({
      success: true,
      is_closed: run.is_closed,
      reveal_answers: run.reveal_answers,
      questions: (questions || []).map((q: any) => {
        const a = answerMap.get(q.id)
        return {
          id: q.id,
          question_text: q.question_text,
          score: q.score,
          correct_answer: run.reveal_answers ? q.correct_answer : null,
          my_answer: a?.answer ?? null,
          score_awarded: run.reveal_answers ? (a?.score_awarded ?? null) : null,
          answered: !!a,
        }
      })
    })
  } catch (err: any) {
    console.error('ERROR getQuestions:', err)
    return res.status(500).json({ error: 'Erreur questions', details: err.message })
  }
}

// =====================================================
// SUBMIT ANSWER
// correct_answer calculé en interne — JAMAIS retourné
// score_awarded stocké en BDD — JAMAIS retourné ici
// =====================================================

async function submitAnswer(userId: string, params: any, res: Response) {
  const { run_question_id, answer } = params

  if (!run_question_id || !isValidUUID(run_question_id))
    return res.status(400).json({ error: 'run_question_id invalide' })
  if (typeof answer !== 'boolean')
    return res.status(400).json({ error: 'answer doit être true ou false' })

  try {
    // Récupérer la question — correct_answer usage INTERNE uniquement
    const { data: rq, error: rqErr } = await supabase
      .from('run_questions')
      .select('id, run_id, correct_answer, score')
      .eq('id', run_question_id).maybeSingle()
    if (rqErr) throw rqErr
    if (!rq) return res.status(404).json({ error: 'Question non trouvée' })

    // Vérifier run ouvert
    const { data: run, error: runErr } = await supabase
      .from('game_runs').select('id, party_id, is_closed, is_visible')
      .eq('id', rq.run_id).maybeSingle()
    if (runErr) throw runErr
    if (!run)            return res.status(404).json({ error: 'Run non trouvé' })
    if (run.is_closed)   return res.status(403).json({ error: 'Run fermé' })
    if (!run.is_visible) return res.status(403).json({ error: 'Run non visible' })

    // Vérifier inscription
    const { data: player, error: playerErr } = await supabase
      .from('party_players').select('id, score')
      .eq('party_id', run.party_id).eq('user_id', userId).maybeSingle()
    if (playerErr) throw playerErr
    if (!player) return res.status(403).json({ error: "Rejoignez d'abord la session" })

    // Vérifier pas déjà répondu
    const { data: existing } = await supabase
      .from('user_run_answers').select('id')
      .eq('run_question_id', run_question_id).eq('user_id', userId).maybeSingle()
    if (existing) return res.status(400).json({ error: 'Déjà répondu à cette question' })

    // Calcul interne — JAMAIS retourné au frontend
    const scoreAwarded = (rq.correct_answer === answer) ? (rq.score ?? 0) : 0

    const { error: insertErr } = await supabase.from('user_run_answers').insert({
      run_id: rq.run_id, run_question_id,
      user_id: userId, answer,
      score_awarded: scoreAwarded,   // stocké — jamais renvoyé ici
    })
    if (insertErr) {
      if (insertErr.code === '23505')
        return res.status(400).json({ error: 'Déjà répondu à cette question' })
      throw insertErr
    }

    await supabase.from('party_players')
      .update({ score: (player.score ?? 0) + scoreAwarded })
      .eq('party_id', run.party_id).eq('user_id', userId)

    // Uniquement success — aucun score, aucune bonne réponse
    return res.json({ success: true })
  } catch (err: any) {
    console.error('ERROR submitAnswer:', err)
    return res.status(500).json({ error: 'Erreur soumission', details: err.message })
  }
}

// =====================================================
// ONGLET 3 — MES RÉPONSES
// Ma réponse (VRAI/FAUX) uniquement
// correct_answer et score_awarded ABSENTS
// =====================================================

async function getMyAnswers(userId: string, params: any, res: Response) {
  const { party_id } = params
  if (!party_id || !isValidUUID(party_id))
    return res.status(400).json({ error: 'party_id invalide' })
  try {
    const { data: player } = await supabase
      .from('party_players').select('id')
      .eq('party_id', party_id).eq('user_id', userId).maybeSingle()
    if (!player) return res.status(403).json({ error: 'Non membre de ce groupe' })

    const { data: runs, error: runsErr } = await supabase
      .from('game_runs').select('id, title')
      .eq('party_id', party_id).eq('is_visible', true)
      .order('created_at', { ascending: true })
    if (runsErr) throw runsErr
    if (!runs || runs.length === 0)
      return res.json({ success: true, runs: [] })

    const runIds = runs.map((r: any) => r.id)

    // answer seulement — PAS score_awarded
    const { data: myAnswers, error: aErr } = await supabase
      .from('user_run_answers').select('run_question_id, run_id, answer')
      .in('run_id', runIds).eq('user_id', userId)
    if (aErr) throw aErr
    if (!myAnswers || myAnswers.length === 0)
      return res.json({ success: true, runs: [] })

    const qIds = myAnswers.map((a: any) => a.run_question_id)

    // question_text et score — PAS correct_answer
    const { data: questions, error: qErr } = await supabase
      .from('run_questions').select('id, run_id, question_text, score').in('id', qIds)
    if (qErr) throw qErr

    const qMap = new Map((questions || []).map((q: any) => [q.id, q]))

    const result = runs
      .map((run: any) => ({
        run_id: run.id, run_title: run.title,
        questions: myAnswers
          .filter((a: any) => a.run_id === run.id)
          .map((a: any) => {
            const q = qMap.get(a.run_question_id)
            return {
              id: a.run_question_id,
              question_text: q?.question_text ?? '',
              score: q?.score ?? 0,
              my_answer: a.answer,
              // correct_answer : ABSENT
              // score_awarded  : ABSENT
            }
          })
      }))
      .filter((r: any) => r.questions.length > 0)

    return res.json({ success: true, runs: result })
  } catch (err: any) {
    console.error('ERROR getMyAnswers:', err)
    return res.status(500).json({ error: 'Erreur mes réponses', details: err.message })
  }
}

// =====================================================
// ONGLET 4 — MES RÉSULTATS
// correct_answer + score_awarded UNIQUEMENT si
//   is_closed=true ET reveal_answers=true
// =====================================================

async function getMyResults(userId: string, params: any, res: Response) {
  const { party_id } = params
  if (!party_id || !isValidUUID(party_id))
    return res.status(400).json({ error: 'party_id invalide' })
  try {
    const { data: player } = await supabase
      .from('party_players').select('id, score')
      .eq('party_id', party_id).eq('user_id', userId).maybeSingle()
    if (!player) return res.status(403).json({ error: 'Non membre de ce groupe' })

    // Double condition : fermé ET révélé par l'admin
    const { data: revealedRuns, error: runsErr } = await supabase
      .from('game_runs').select('id, title')
      .eq('party_id', party_id)
      .eq('is_closed', true)
      .eq('reveal_answers', true)
      .order('created_at', { ascending: true })
    if (runsErr) throw runsErr

    if (!revealedRuns || revealedRuns.length === 0) {
      return res.json({
        success: true, total_score: 0, runs: [], pending: true,
        message: "Les résultats seront révélés par l'administrateur à la fin du jeu."
      })
    }

    const runIds = revealedRuns.map((r: any) => r.id)

    // Vue sécurisée — correct_answer visible car reveal_answers=true
    const { data: questions, error: qErr } = await supabase
      .from('view_run_questions')
      .select('id, run_id, question_text, score, correct_answer')
      .in('run_id', runIds)
    if (qErr) throw qErr

    const { data: myAnswers, error: aErr } = await supabase
      .from('user_run_answers')
      .select('run_question_id, run_id, answer, score_awarded')
      .in('run_id', runIds).eq('user_id', userId)
    if (aErr) throw aErr

    const aMap = new Map((myAnswers || []).map((a: any) => [a.run_question_id, a]))
    const totalScore = (myAnswers || []).reduce((s: number, a: any) => s + (a.score_awarded ?? 0), 0)

    const runs = revealedRuns.map((run: any) => ({
      run_id: run.id, run_title: run.title,
      questions: (questions || [])
        .filter((q: any) => q.run_id === run.id)
        .map((q: any) => {
          const a = aMap.get(q.id)
          return {
            id: q.id, question_text: q.question_text, score: q.score,
            correct_answer: q.correct_answer,    // visible car admin a révélé
            my_answer: a?.answer ?? null,
            score_awarded: a?.score_awarded ?? 0,
            answered: !!a,
          }
        })
    }))

    return res.json({ success: true, total_score: totalScore, runs, pending: false })
  } catch (err: any) {
    console.error('ERROR getMyResults:', err)
    return res.status(500).json({ error: 'Erreur résultats', details: err.message })
  }
}

// =====================================================
// GET LEADERBOARD (classement d'un run)
// Score révélé car run fermé
// =====================================================

async function getLeaderboard(userId: string, params: any, res: Response) {
  const { run_id } = params
  if (!run_id || !isValidUUID(run_id))
    return res.status(400).json({ error: 'run_id invalide' })
  try {
    const { data: run, error: runError } = await supabase
      .from('game_runs').select('party_id, is_closed')
      .eq('id', run_id).maybeSingle()
    if (runError) throw runError
    if (!run) return res.status(404).json({ error: 'Run non trouvé' })

    const { data: runScores, error: scoresError } = await supabase
      .from('user_run_answers').select('user_id, score_awarded')
      .eq('run_id', run_id)
    if (scoresError) throw scoresError

    const scoreMap = new Map<string, number>()
    for (const row of runScores || []) {
      scoreMap.set(row.user_id, (scoreMap.get(row.user_id) ?? 0) + row.score_awarded)
    }

    const { data: players, error: playersError } = await supabase
      .from('party_players')
      .select('user_id, profiles:user_id (nom, prenom, avatar_url)')
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
      .sort((a: any, b: any) => b.run_score - a.run_score)
      .map((p: any, index: number) => ({ rank: index + 1, ...p }))

    return res.json({ success: true, leaderboard, is_closed: run.is_closed })
  } catch (err: any) {
    console.error('ERROR getLeaderboard:', err)
    return res.status(500).json({ error: 'Erreur classement', details: err.message })
  }
}

// =====================================================
// GET PARTY HISTORY
// Historique complet — uniquement runs reveal_answers=true
// =====================================================

async function getPartyHistory(userId: string, params: any, res: Response) {
  const { party_id } = params
  if (!party_id || !isValidUUID(party_id))
    return res.status(400).json({ error: 'party_id invalide' })
  try {
    const { data: playerData } = await supabase
      .from('party_players').select('score')
      .eq('party_id', party_id).eq('user_id', userId).maybeSingle()

    const totalScore = playerData?.score ?? null

    const { data: runs, error: runsError } = await supabase
      .from('game_runs').select('id, title, is_closed, reveal_answers')
      .eq('party_id', party_id)
      .eq('is_closed', true).eq('reveal_answers', true)
      .order('created_at', { ascending: true })
    if (runsError) throw runsError

    if (!runs || runs.length === 0) {
      return res.json({
        success: true, history: [],
        total_score: totalScore, is_member: totalScore !== null
      })
    }

    const runIds = runs.map((r: any) => r.id)

    const { data: questions, error: qError } = await supabase
      .from('view_run_questions')
      .select('id, run_id, question_text, correct_answer, score')
      .in('run_id', runIds)
    if (qError) throw qError

    const { data: answers, error: aError } = await supabase
      .from('user_run_answers').select('run_question_id, answer, score_awarded')
      .in('run_id', runIds).eq('user_id', userId)
    if (aError) throw aError

    const answerMap = new Map<string, any>(
      (answers || []).map((a: any) => [a.run_question_id, a])
    )
    const runMap = new Map((runs || []).map((r: any) => [r.id, { ...r, questions: [] as any[] }]))

    for (const q of questions || []) {
      const myAnswer = answerMap.get(q.id)
      const run = runMap.get(q.run_id)
      if (run) run.questions.push({
        id:             q.id,
        question_text:  q.question_text,
        correct_answer: q.correct_answer,
        score:          q.score,
        my_answer:      myAnswer?.answer ?? null,
        score_awarded:  myAnswer?.score_awarded ?? null,
        answered:       !!myAnswer,
      })
    }

    return res.json({
      success:     true,
      history:     Array.from(runMap.values()).map(r => ({
        run_id: r.id, run_title: r.title, questions: r.questions,
      })),
      total_score: totalScore,
      is_member:   totalScore !== null,
    })
  } catch (err: any) {
    console.error('ERROR getPartyHistory:', err)
    return res.status(500).json({ error: 'Erreur historique', details: err.message })
  }
}
