// =====================================================
// HANDLER ADMIN - COMPLET
// =====================================================

import { Request, Response } from 'express'
import supabase from '../config/supabase'
import crypto from 'crypto'

export async function handleAdmin(req: Request, res: Response) {
  const { function: functionName, email, password, ...params } = req.body

  console.log(`[${new Date().toISOString()}] admin/${functionName}`)

  if (!email || !password) {
    return res.status(401).json({
      error: 'Email et mot de passe requis',
      timestamp: new Date().toISOString()
    })
  }

  try {
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex')

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, password_hash, role, nom, prenom')
      .eq('email', email.toLowerCase().trim())
      .single()

    if (profileError || !profile) {
      console.warn(`⚠️  Email non trouvé: ${email}`)
      return res.status(401).json({
        error: 'Email ou mot de passe incorrect',
        timestamp: new Date().toISOString()
      })
    }

    if (profile.password_hash !== hashedPassword) {
      console.warn(`⚠️  Mot de passe incorrect`)
      return res.status(401).json({
        error: 'Email ou mot de passe incorrect',
        timestamp: new Date().toISOString()
      })
    }

    console.log(`✅ Auth: ${profile.nom} ${profile.prenom} (${profile.role})`)

    const allowedRoles = ['admin', 'adminpro', 'supreme']
    const rejectedRoles = ['user', 'userpro']

    if (rejectedRoles.includes(profile.role)) {
      return res.status(403).json({
        error: 'Accès refusé : rôle insuffisant',
        details: `Votre rôle (${profile.role}) ne permet pas l'accès admin`,
        required_roles: allowedRoles,
        timestamp: new Date().toISOString()
      })
    }

    if (!allowedRoles.includes(profile.role)) {
      return res.status(403).json({
        error: 'Accès refusé : rôle invalide',
        timestamp: new Date().toISOString()
      })
    }

    console.log(`✅ Autorisation: ${profile.role}`)

    switch (functionName) {
      case 'createSession':
        return await createSession(profile.id, params, res)
      case 'createParty':
        return await createParty(profile.id, params, res)
      case 'createRun':
        return await createRun(profile.id, params, res)
      case 'addQuestions':
        return await addQuestions(profile.id, params, res)
      case 'setVisibility':
        return await setVisibility(params, res)
      case 'closeRun':
        return await closeRun(params, res)
      case 'getStatistics':
        return await getStatistics(params, res)
      default:
        return res.status(400).json({
          error: 'Fonction inconnue',
          available: ['createSession', 'createParty', 'createRun', 'addQuestions', 'setVisibility', 'closeRun', 'getStatistics'],
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

async function createSession(adminId: string, params: any, res: Response) {
  try {
    const { game_key, title, description, is_paid, price_cfa } = params
    if (!game_key || !title) return res.status(400).json({ error: 'game_key et title requis' })

    const { data: game } = await supabase.from('games').select('id').eq('key_name', game_key).single()
    if (!game) return res.status(404).json({ error: 'Jeu non trouvé' })

    const { data: session, error } = await supabase
      .from('game_sessions')
      .insert({ game_id: game.id, title, description: description || null, is_paid: is_paid || false, price_cfa: price_cfa || 0, created_by: adminId })
      .select()
      .single()

    if (error) throw error

    return res.json({ success: true, session_id: session.id, session, message: 'Session créée', timestamp: new Date().toISOString() })
  } catch (error: any) {
    return res.status(500).json({ error: 'Erreur création session', details: error.message })
  }
}

async function createParty(_adminId: string, params: any, res: Response) {
  try {
    const { session_id, title, min_score, min_rank } = params
    if (!session_id || !title) return res.status(400).json({ error: 'session_id et title requis' })

    const { data, error } = await supabase.rpc('create_party_for_session', {
      p_session_id: session_id,
      p_title: title,
      p_min_score: min_score || null,
      p_min_rank: min_rank || null
    })
    if (error) throw error

    return res.json({ success: true, party_id: data, message: 'Party créée', timestamp: new Date().toISOString() })
  } catch (error: any) {
    return res.status(500).json({ error: 'Erreur création party', details: error.message })
  }
}

async function createRun(_adminId: string, params: any, res: Response) {
  try {
    const { party_id, title } = params
    if (!party_id || !title) return res.status(400).json({ error: 'party_id et title requis' })

    const { data, error } = await supabase.rpc('create_run', { p_party_id: party_id, p_title: title })
    if (error) throw error

    return res.json({ success: true, run_id: data, message: 'Run créé', timestamp: new Date().toISOString() })
  } catch (error: any) {
    return res.status(500).json({ error: 'Erreur création run', details: error.message })
  }
}

async function addQuestions(adminId: string, params: any, res: Response) {
  try {
    const { run_id, questions } = params
    if (!run_id || !Array.isArray(questions)) return res.status(400).json({ error: 'run_id et questions requis' })

    const questionsToInsert = questions.map((q: any) => ({
      run_id,
      question_text: q.question,
      correct_answer: q.answer,
      score: q.score || 10,
      created_by: adminId
    }))

    const { data, error } = await supabase.from('run_questions').insert(questionsToInsert).select()
    if (error) throw error

    return res.json({ success: true, questions_added: data.length, questions: data, message: `${data.length} question(s) ajoutée(s)`, timestamp: new Date().toISOString() })
  } catch (error: any) {
    return res.status(500).json({ error: 'Erreur ajout questions', details: error.message })
  }
}

async function setVisibility(params: any, res: Response) {
  try {
    const { run_id, visible } = params
    if (!run_id || typeof visible !== 'boolean') return res.status(400).json({ error: 'run_id et visible requis' })

    const { error } = await supabase.rpc('set_run_visibility', { p_run_id: run_id, p_visible: visible })
    if (error) throw error

    return res.json({ success: true, message: visible ? 'Run visible' : 'Run masqué', timestamp: new Date().toISOString() })
  } catch (error: any) {
    return res.status(500).json({ error: 'Erreur visibilité', details: error.message })
  }
}

async function closeRun(params: any, res: Response) {
  try {
    const { run_id, closed } = params
    if (!run_id || typeof closed !== 'boolean') return res.status(400).json({ error: 'run_id et closed requis' })

    const { error } = await supabase.rpc('set_run_closed', { p_run_id: run_id, p_closed: closed })
    if (error) throw error

    return res.json({ success: true, message: closed ? 'Run fermé' : 'Run réouvert', timestamp: new Date().toISOString() })
  } catch (error: any) {
    return res.status(500).json({ error: 'Erreur fermeture', details: error.message })
  }
}

async function getStatistics(params: any, res: Response) {
  try {
    const { run_id } = params
    if (!run_id) return res.status(400).json({ error: 'run_id requis' })

    const { data: run } = await supabase.from('game_runs').select('party_id, title, is_visible, is_closed, is_started').eq('id', run_id).single()
    if (!run) return res.status(404).json({ error: 'Run non trouvé' })

    const { count: questionsCount } = await supabase.from('run_questions').select('*', { count: 'exact', head: true }).eq('run_id', run_id)
    const { count: answersCount } = await supabase.from('user_run_answers').select('*', { count: 'exact', head: true }).eq('run_id', run_id)
    const { count: playersCount } = await supabase.from('party_players').select('*', { count: 'exact', head: true }).eq('party_id', run.party_id)

    return res.json({
      success: true,
      statistics: {
        run_id,
        title: run.title,
        is_visible: run.is_visible,
        is_closed: run.is_closed,
        is_started: run.is_started,
        total_questions: questionsCount || 0,
        total_answers: answersCount || 0,
        total_players: playersCount || 0
      },
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    return res.status(500).json({ error: 'Erreur stats', details: error.message })
  }
}
