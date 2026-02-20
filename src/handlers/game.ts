// =====================================================
// HANDLER GAME — ANON + JWT UNIQUEMENT
//
// ARCHITECTURE SÉCURITÉ :
// ──────────────────────────────────────────────────
// • db = getClientForUser(access_token)
//   → ANON + JWT utilisateur → auth.uid() actif → RLS respecté
//   → Pas de SERVICE_ROLE ici — jamais
//
// • correct_answer ne quitte JAMAIS Node.js :
//   → submitAnswer appelle le RPC submit_answer (SECURITY DEFINER)
//   → Tout le calcul de score se fait dans PostgreSQL
//   → Node.js reçoit uniquement void (succès ou exception)
//
// RÈGLE SCORES :
//   → score_awarded stocké en base à chaque réponse
//   → CACHÉ tant que run.is_closed = false OU reveal_answers = false
//   → Visible dans onglet 4 UNIQUEMENT quand admin ferme ET révèle
//   → Score total = somme des score_awarded des runs révélés seulement
//
// 4 ONGLETS :
//   1. listMySessions         → sessions rejointes + score runs révélés
//   2. listAvailableSessions  → sessions disponibles
//   3. getMyAnswers           → ma réponse uniquement (pas de score)
//   4. getMyResults           → correct_answer + score si run révélé
// =====================================================

import { Request, Response } from 'express'
import { getClientForUser } from '../config/supabase'

const isValidUUID = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

export async function handleGame(req: Request, res: Response) {
  const { function: fn, user_id, access_token, ...params } = req.body

  console.log(`[${new Date().toISOString()}] Game: ${fn} | user: ${user_id ?? '?'}`)

  if (!user_id)              return res.status(401).json({ error: 'user_id requis' })
  if (!isValidUUID(user_id)) return res.status(400).json({ error: 'user_id invalide' })
  if (!access_token)         return res.status(401).json({ error: 'access_token requis — reconnectez-vous' })

  // Client ANON + JWT → auth.uid() = user_id → RLS actif
  const db = getClientForUser(access_token)

  try {
    switch (fn) {
      case 'listMySessions':         return await listMySessions(user_id, db, params, res)
      case 'listAvailableSessions':  return await listAvailableSessions(user_id, db, params, res)
      case 'joinSession':            return await joinSession(db, params, res)
      case 'listPartiesForSession':  return await listPartiesForSession(db, params, res)
      case 'getUnansweredQuestions': return await getUnansweredQuestions(user_id, db, params, res)
      case 'submitAnswer':           return await submitAnswer(db, params, res)
      case 'getMyAnswers':           return await getMyAnswers(user_id, db, params, res)
      case 'getMyResults':           return await getMyResults(user_id, db, params, res)
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
// Score affiché = somme des runs révélés uniquement
// =====================================================

async function listMySessions(userId: string, db: any, params: any, res: Response) {
  const { game_key } = params
  try {
    // Parties rejointes
    const { data: myParties, error: e1 } = await db
      .from('party_players').select('party_id, score').eq('user_id', userId)
    if (e1) throw e1
    if (!myParties || myParties.length === 0)
      return res.json({ success: true, sessions: [] })

    const partyIds = myParties.map((p: any) => p.party_id)

    const { data: partiesData, error: e2 } = await db
      .from('game_parties').select('id, session_id').in('id', partyIds)
    if (e2) throw e2

    const sessionIds = [...new Set(
      (partiesData || []).map((p: any) => p.session_id).filter(Boolean)
    )]
    if (sessionIds.length === 0) return res.json({ success: true, sessions: [] })

    const { data: sessions, error: e3 } = await db
      .from('game_sessions').select('id, title, description, is_paid, price_cfa, game_id')
      .in('id', sessionIds)
    if (e3) throw e3

    let filtered = sessions || []
    if (game_key) {
      const { data: game } = await db
        .from('games').select('id').eq('key_name', game_key).maybeSingle()
      if (game) filtered = filtered.filter((s: any) => s.game_id === game.id)
    }

    // Score = somme des score_awarded des runs fermés ET révélés par l'admin
    // (pas le score cumulé brut de party_players qui inclut les runs non révélés)
    const scoreMap = new Map<string, number>()

    for (const party of partiesData || []) {
      // Runs révélés de cette party
      const { data: revRuns } = await db
        .from('game_runs').select('id')
        .eq('party_id', party.id)
        .eq('is_closed', true)
        .eq('reveal_answers', true)

      if (!revRuns || revRuns.length === 0) {
        scoreMap.set(party.session_id, scoreMap.get(party.session_id) ?? 0)
        continue
      }

      const revRunIds = revRuns.map((r: any) => r.id)

      const { data: myAnswers } = await db
        .from('user_run_answers').select('score_awarded')
        .in('run_id', revRunIds).eq('user_id', userId)

      const revealed = (myAnswers || []).reduce(
        (sum: number, a: any) => sum + (a.score_awarded ?? 0), 0
      )
      const cur = scoreMap.get(party.session_id) ?? 0
      scoreMap.set(party.session_id, Math.max(cur, revealed))
    }

    return res.json({
      success: true,
      sessions: filtered.map((s: any) => ({
        id:          s.id,
        title:       s.title,
        description: s.description,
        is_paid:     s.is_paid,
        price_cfa:   s.price_cfa,
        my_score:    scoreMap.get(s.id) ?? 0,  // score des runs révélés seulement
      }))
    })
  } catch (err: any) {
    console.error('ERROR listMySessions:', err)
    return res.status(500).json({ error: 'Erreur mes sessions', details: err.message })
  }
}

// =====================================================
// ONGLET 2 — EXPLORER
// =====================================================

async function listAvailableSessions(userId: string, db: any, params: any, res: Response) {
  const { game_key } = params
  try {
    const { data: myParties } = await db
      .from('party_players').select('game_parties!inner(session_id)').eq('user_id', userId)

    const mySessionIds = new Set<string>()
    for (const mp of myParties || []) {
      const sid = (mp as any).game_parties?.session_id
      if (sid) mySessionIds.add(sid)
    }

    let gameId: string | null = null
    if (game_key) {
      const { data: game } = await db
        .from('games').select('id').eq('key_name', game_key).maybeSingle()
      gameId = game?.id ?? null
    }

    let query = db.from('game_sessions')
      .select('id, title, description, is_paid, price_cfa')
      .order('created_at', { ascending: false })
    if (gameId) query = query.eq('game_id', gameId)

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
// JOIN SESSION — RPC join_session_smart
// auth.uid() fonctionne via JWT dans le client
// =====================================================

async function joinSession(db: any, params: any, res: Response) {
  const { session_id } = params

  if (!session_id || !isValidUUID(session_id))
    return res.status(400).json({ error: 'session_id invalide' })

  try {
    const { error: rpcErr } = await db.rpc('join_session_smart', {
      p_session_id: session_id
    })

    if (rpcErr) {
      if (rpcErr.message?.includes('participez déjà'))
        return res.json({ success: true, message: 'Déjà inscrit', session_id })
      if (rpcErr.message?.includes('Solde insuffisant') || rpcErr.message?.includes('payante'))
        return res.status(400).json({ error: rpcErr.message })
      if (rpcErr.message?.includes('introuvable'))
        return res.status(404).json({ error: rpcErr.message })
      throw rpcErr
    }

    return res.json({ success: true, message: 'Session rejointe', session_id })
  } catch (err: any) {
    console.error('ERROR joinSession:', err)
    return res.status(500).json({ error: 'Erreur joinSession', details: err.message })
  }
}

// =====================================================
// LIST PARTIES FOR SESSION
// =====================================================

async function listPartiesForSession(db: any, params: any, res: Response) {
  const { session_id } = params
  if (!session_id || !isValidUUID(session_id))
    return res.status(400).json({ error: 'session_id invalide' })
  try {
    const { data: parties, error } = await db
      .from('game_parties').select('id, title, is_initial, min_score, min_rank')
      .eq('session_id', session_id).order('created_at', { ascending: true })
    if (error) throw error
    return res.json({ success: true, parties: parties || [] })
  } catch (err: any) {
    console.error('ERROR listPartiesForSession:', err)
    return res.status(500).json({ error: 'Erreur groupes', details: err.message })
  }
}

// =====================================================
// GET UNANSWERED QUESTIONS
// correct_answer ABSENT — jamais envoyé au frontend
// =====================================================

async function getUnansweredQuestions(userId: string, db: any, params: any, res: Response) {
  const { party_id } = params
  if (!party_id || !isValidUUID(party_id))
    return res.status(400).json({ error: 'party_id invalide' })
  try {
    const { data: player } = await db
      .from('party_players').select('id')
      .eq('party_id', party_id).eq('user_id', userId).maybeSingle()
    if (!player) return res.status(403).json({ error: "Rejoignez d'abord la session" })

    const { data: runs } = await db
      .from('game_runs').select('id')
      .eq('party_id', party_id).eq('is_visible', true).eq('is_closed', false)
    if (!runs || runs.length === 0)
      return res.json({ success: true, questions: [] })

    const runIds = runs.map((r: any) => r.id)

    // id, run_id, question_text, score — correct_answer JAMAIS ici
    const { data: allQs, error: qErr } = await db
      .from('run_questions').select('id, run_id, question_text, score')
      .in('run_id', runIds)
    if (qErr) throw qErr

    const { data: answers } = await db
      .from('user_run_answers').select('run_question_id')
      .in('run_id', runIds).eq('user_id', userId)

    const answeredIds = new Set((answers || []).map((a: any) => a.run_question_id))

    return res.json({
      success: true,
      questions: (allQs || [])
        .filter((q: any) => !answeredIds.has(q.id))
        .map((q: any) => ({
          id: q.id, run_id: q.run_id, question_text: q.question_text, score: q.score
        }))
    })
  } catch (err: any) {
    console.error('ERROR getUnansweredQuestions:', err)
    return res.status(500).json({ error: 'Erreur questions', details: err.message })
  }
}

// =====================================================
// SUBMIT ANSWER — RPC SECURITY DEFINER
//
// SÉCURITÉ ABSOLUE :
//   • Le RPC submit_answer tourne dans PostgreSQL
//   • correct_answer est lu DANS la DB, ne transite jamais vers Node.js
//   • Node.js appelle le RPC et reçoit void (succès) ou une exception
//   • Le frontend reçoit uniquement { success: true }
//   • Aucune donnée de score ni de bonne réponse ne sort
// =====================================================

async function submitAnswer(db: any, params: any, res: Response) {
  const { run_question_id, answer } = params

  if (!run_question_id || !isValidUUID(run_question_id))
    return res.status(400).json({ error: 'run_question_id invalide' })
  if (typeof answer !== 'boolean')
    return res.status(400).json({ error: 'answer doit être true ou false' })

  try {
    // RPC SECURITY DEFINER — correct_answer reste dans PostgreSQL
    const { error: rpcErr } = await db.rpc('submit_answer', {
      p_run_question_id: run_question_id,
      p_answer:          answer,
    })

    if (rpcErr) {
      if (rpcErr.message?.includes('Déjà répondu'))
        return res.status(400).json({ error: 'Déjà répondu à cette question' })
      if (rpcErr.message?.includes('fermé'))
        return res.status(403).json({ error: 'Run fermé — plus de réponses acceptées' })
      if (rpcErr.message?.includes('visible'))
        return res.status(403).json({ error: 'Run non visible' })
      if (rpcErr.message?.includes('Rejoignez'))
        return res.status(403).json({ error: "Rejoignez d'abord la session" })
      if (rpcErr.message?.includes('introuvable'))
        return res.status(404).json({ error: rpcErr.message })
      throw rpcErr
    }

    // Uniquement success — aucun score, aucune bonne réponse
    return res.json({ success: true })

  } catch (err: any) {
    console.error('ERROR submitAnswer:', err)
    return res.status(500).json({ error: 'Erreur soumission', details: err.message })
  }
}

// =====================================================
// ONGLET 3 — MES RÉPONSES
// MA réponse (VRAI/FAUX) uniquement
// correct_answer et score_awarded : ABSENTS
// =====================================================

async function getMyAnswers(userId: string, db: any, params: any, res: Response) {
  const { party_id } = params
  if (!party_id || !isValidUUID(party_id))
    return res.status(400).json({ error: 'party_id invalide' })
  try {
    const { data: player } = await db
      .from('party_players').select('id')
      .eq('party_id', party_id).eq('user_id', userId).maybeSingle()
    if (!player) return res.status(403).json({ error: 'Non membre de ce groupe' })

    const { data: runs, error: runsErr } = await db
      .from('game_runs').select('id, title')
      .eq('party_id', party_id).eq('is_visible', true)
      .order('created_at', { ascending: true })
    if (runsErr) throw runsErr
    if (!runs || runs.length === 0)
      return res.json({ success: true, runs: [] })

    const runIds = runs.map((r: any) => r.id)

    // answer seulement — PAS score_awarded
    const { data: myAnswers, error: aErr } = await db
      .from('user_run_answers').select('run_question_id, run_id, answer')
      .in('run_id', runIds).eq('user_id', userId)
    if (aErr) throw aErr
    if (!myAnswers || myAnswers.length === 0)
      return res.json({ success: true, runs: [] })

    const qIds = myAnswers.map((a: any) => a.run_question_id)

    // question_text, score — PAS correct_answer
    const { data: questions, error: qErr } = await db
      .from('run_questions').select('id, run_id, question_text, score').in('id', qIds)
    if (qErr) throw qErr

    const qMap = new Map((questions || []).map((q: any) => [q.id, q]))

    const result = runs
      .map((run: any) => ({
        run_id:    run.id,
        run_title: run.title,
        questions: myAnswers
          .filter((a: any) => a.run_id === run.id)
          .map((a: any) => {
            const q = qMap.get(a.run_question_id)
            return {
              id:            a.run_question_id,
              question_text: q?.question_text ?? '',
              score:         q?.score ?? 0,
              my_answer:     a.answer,
              // correct_answer : JAMAIS ICI
              // score_awarded  : JAMAIS ICI — seulement dans getMyResults
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
//
// correct_answer + score_awarded visibles UNIQUEMENT si :
//   • run.is_closed = true    (admin a fermé le run)
//   • run.reveal_answers = true (admin a révélé les réponses)
//
// Score total = somme des score_awarded des runs révélés SEULEMENT
// Tant qu'un run n'est pas révélé → ses points ne comptent pas
// =====================================================

async function getMyResults(userId: string, db: any, params: any, res: Response) {
  const { party_id } = params
  if (!party_id || !isValidUUID(party_id))
    return res.status(400).json({ error: 'party_id invalide' })
  try {
    const { data: player } = await db
      .from('party_players').select('id')
      .eq('party_id', party_id).eq('user_id', userId).maybeSingle()
    if (!player) return res.status(403).json({ error: 'Non membre de ce groupe' })

    // Uniquement runs fermés ET révélés par l'admin — double condition
    const { data: revealedRuns, error: runsErr } = await db
      .from('game_runs').select('id, title')
      .eq('party_id', party_id)
      .eq('is_closed', true)
      .eq('reveal_answers', true)
      .order('created_at', { ascending: true })
    if (runsErr) throw runsErr

    if (!revealedRuns || revealedRuns.length === 0) {
      return res.json({
        success:     true,
        total_score: 0,
        runs:        [],
        pending:     true,
        message:     "Les résultats seront révélés par l'administrateur à la fin du jeu."
      })
    }

    const runIds = revealedRuns.map((r: any) => r.id)

    // vue sécurisée — correct_answer visible car reveal_answers=true (géré par la vue)
    const { data: questions, error: qErr } = await db
      .from('view_run_questions')
      .select('id, run_id, question_text, score, correct_answer')
      .in('run_id', runIds)
    if (qErr) throw qErr

    // score_awarded lisible car run révélé
    const { data: myAnswers, error: aErr } = await db
      .from('user_run_answers')
      .select('run_question_id, run_id, answer, score_awarded')
      .in('run_id', runIds).eq('user_id', userId)
    if (aErr) throw aErr

    const aMap = new Map((myAnswers || []).map((a: any) => [a.run_question_id, a]))

    // Score total = somme des points des runs révélés UNIQUEMENT
    const totalScore = (myAnswers || []).reduce(
      (sum: number, a: any) => sum + (a.score_awarded ?? 0), 0
    )

    const runs = revealedRuns.map((run: any) => ({
      run_id:    run.id,
      run_title: run.title,
      questions: (questions || [])
        .filter((q: any) => q.run_id === run.id)
        .map((q: any) => {
          const a = aMap.get(q.id)
          return {
            id:             q.id,
            question_text:  q.question_text,
            score:          q.score,
            correct_answer: q.correct_answer,    // visible — admin a révélé
            my_answer:      a?.answer ?? null,
            score_awarded:  a?.score_awarded ?? 0,
            answered:       !!a,
          }
        })
    }))

    return res.json({ success: true, total_score: totalScore, runs, pending: false })
  } catch (err: any) {
    console.error('ERROR getMyResults:', err)
    return res.status(500).json({ error: 'Erreur résultats', details: err.message })
  }
}
