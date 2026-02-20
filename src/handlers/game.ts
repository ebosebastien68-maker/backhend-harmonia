// =====================================================
// HANDLER GAME — SÉCURISÉ — CLÉ ANON UNIQUEMENT
//
// COMMENT FONCTIONNE LA SÉCURITÉ :
// ──────────────────────────────────────────────────
// 1. Le backend utilise la clé ANON → RLS Supabase actif
// 2. La vue view_run_questions masque correct_answer
//    tant que reveal_answers = false sur le run
// 3. submitAnswer lit correct_answer en interne pour
//    calculer le score, mais ne le retourne JAMAIS au client
// 4. getMyAnswers (onglet 3) → ma réponse uniquement, 0 score
// 5. getMyResults (onglet 4) → score + bonne réponse
//    UNIQUEMENT si reveal_answers = true (admin a fermé le run)
//
// 4 ONGLETS :
//   1. listMySessions         → sessions rejointes + mon score global
//   2. listAvailableSessions  → sessions disponibles (pas encore rejoint)
//   3. getMyAnswers           → mes réponses envoyées (PAS de score ni bonne réponse)
//   4. getMyResults           → résultats révélés par l'admin UNIQUEMENT
//
// =====================================================

import { Request, Response } from 'express'
import supabase from '../config/supabase'

const isValidUUID = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

export async function handleGame(req: Request, res: Response) {
  const { function: fn, user_id, ...params } = req.body

  console.log(`[${new Date().toISOString()}] Game: ${fn} | user: ${user_id ?? '?'}`)

  if (!user_id)              return res.status(401).json({ error: 'user_id requis' })
  if (!isValidUUID(user_id)) return res.status(400).json({ error: 'user_id invalide' })

  try {
    switch (fn) {
      case 'listMySessions':         return await listMySessions(user_id, params, res)
      case 'listAvailableSessions':  return await listAvailableSessions(user_id, params, res)
      case 'joinSession':            return await joinSession(user_id, params, res)
      case 'listPartiesForSession':  return await listPartiesForSession(user_id, params, res)
      case 'getUnansweredQuestions': return await getUnansweredQuestions(user_id, params, res)
      case 'submitAnswer':           return await submitAnswer(user_id, params, res)
      case 'getMyAnswers':           return await getMyAnswers(user_id, params, res)
      case 'getMyResults':           return await getMyResults(user_id, params, res)
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
// =====================================================

async function listMySessions(userId: string, params: any, res: Response) {
  const { game_key } = params
  try {
    const { data: myParties, error: e1 } = await supabase
      .from('party_players').select('party_id, score').eq('user_id', userId)
    if (e1) throw e1
    if (!myParties || myParties.length === 0)
      return res.json({ success: true, sessions: [] })

    const partyIds = myParties.map((p: any) => p.party_id)

    const { data: partiesData, error: e2 } = await supabase
      .from('game_parties').select('id, session_id').in('id', partyIds)
    if (e2) throw e2

    const sessionIds = [...new Set(
      (partiesData || []).map((p: any) => p.session_id).filter(Boolean)
    )]
    if (sessionIds.length === 0) return res.json({ success: true, sessions: [] })

    const { data: sessions, error: e3 } = await supabase
      .from('game_sessions').select('id, title, description, is_paid, price_cfa, game_id')
      .in('id', sessionIds)
    if (e3) throw e3

    let filtered = sessions || []
    if (game_key) {
      const { data: game } = await supabase
        .from('games').select('id').eq('key_name', game_key).maybeSingle()
      if (game) filtered = filtered.filter((s: any) => s.game_id === game.id)
    }

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
// =====================================================

async function listAvailableSessions(userId: string, params: any, res: Response) {
  const { game_key } = params
  try {
    const { data: myParties } = await supabase
      .from('party_players').select('game_parties!inner(session_id)').eq('user_id', userId)

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
      .from('game_sessions').select('id, title, description, is_paid, price_cfa')
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
  const { session_id } = params
  if (!session_id || !isValidUUID(session_id))
    return res.status(400).json({ error: 'session_id invalide' })
  try {
    const { data: parties, error } = await supabase
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
// correct_answer JAMAIS retourné
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
    if (!runs || runs.length === 0) return res.json({ success: true, questions: [] })

    const runIds = runs.map((r: any) => r.id)

    const { data: allQs, error: qErr } = await supabase
      .from('run_questions').select('id, run_id, question_text, score').in('run_id', runIds)
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
        }))
    })
  } catch (err: any) {
    console.error('ERROR getUnansweredQuestions:', err)
    return res.status(500).json({ error: 'Erreur questions', details: err.message })
  }
}

// =====================================================
// SUBMIT ANSWER
// correct_answer calculé en interne, JAMAIS retourné
// score_awarded stocké en BDD, JAMAIS retourné ici
// =====================================================

async function submitAnswer(userId: string, params: any, res: Response) {
  const { run_question_id, answer } = params

  if (!run_question_id || !isValidUUID(run_question_id))
    return res.status(400).json({ error: 'run_question_id invalide' })
  if (typeof answer !== 'boolean')
    return res.status(400).json({ error: 'answer doit être true ou false' })

  try {
    const { data: rq, error: rqErr } = await supabase
      .from('run_questions').select('id, run_id, correct_answer, score')
      .eq('id', run_question_id).maybeSingle()
    if (rqErr) throw rqErr
    if (!rq) return res.status(404).json({ error: 'Question non trouvée' })

    const { data: run, error: runErr } = await supabase
      .from('game_runs').select('id, party_id, is_closed, is_visible')
      .eq('id', rq.run_id).maybeSingle()
    if (runErr) throw runErr
    if (!run)            return res.status(404).json({ error: 'Run non trouvé' })
    if (run.is_closed)   return res.status(403).json({ error: 'Run fermé' })
    if (!run.is_visible) return res.status(403).json({ error: 'Run non visible' })

    const { data: player, error: playerErr } = await supabase
      .from('party_players').select('id, score')
      .eq('party_id', run.party_id).eq('user_id', userId).maybeSingle()
    if (playerErr) throw playerErr
    if (!player) return res.status(403).json({ error: "Rejoignez d'abord la session" })

    const { data: existing } = await supabase
      .from('user_run_answers').select('id')
      .eq('run_question_id', run_question_id).eq('user_id', userId).maybeSingle()
    if (existing) return res.status(400).json({ error: 'Déjà répondu à cette question' })

    // Calcul interne — JAMAIS retourné
    const scoreAwarded = (rq.correct_answer === answer) ? (rq.score ?? 0) : 0

    const { error: insertErr } = await supabase.from('user_run_answers').insert({
      run_id: rq.run_id, run_question_id, user_id: userId,
      answer, score_awarded: scoreAwarded,
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
// Ma réponse uniquement — correct_answer et score ABSENTS
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
    if (!runs || runs.length === 0) return res.json({ success: true, runs: [] })

    const runIds = runs.map((r: any) => r.id)

    // answer seulement — PAS score_awarded
    const { data: myAnswers, error: aErr } = await supabase
      .from('user_run_answers').select('run_question_id, run_id, answer')
      .in('run_id', runIds).eq('user_id', userId)
    if (aErr) throw aErr
    if (!myAnswers || myAnswers.length === 0) return res.json({ success: true, runs: [] })

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
              // correct_answer : ABSENT — jamais ici
              // score_awarded  : ABSENT — seulement dans getMyResults
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
//   is_closed = true ET reveal_answers = true
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

    // Runs fermés ET révélés — double condition
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
      .from('view_run_questions').select('id, run_id, question_text, score, correct_answer')
      .in('run_id', runIds)
    if (qErr) throw qErr

    // score_awarded visible car run révélé
    const { data: myAnswers, error: aErr } = await supabase
      .from('user_run_answers').select('run_question_id, run_id, answer, score_awarded')
      .in('run_id', runIds).eq('user_id', userId)
    if (aErr) throw aErr

    const aMap = new Map((myAnswers || []).map((a: any) => [a.run_question_id, a]))
    const totalScore = (myAnswers || []).reduce((sum: number, a: any) => sum + (a.score_awarded ?? 0), 0)

    const runs = revealedRuns.map((run: any) => ({
      run_id: run.id, run_title: run.title,
      questions: (questions || [])
        .filter((q: any) => q.run_id === run.id)
        .map((q: any) => {
          const a = aMap.get(q.id)
          return {
            id: q.id,
            question_text: q.question_text,
            score: q.score,
            correct_answer: q.correct_answer,   // visible — admin a révélé
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
