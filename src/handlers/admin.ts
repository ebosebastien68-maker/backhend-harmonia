// =====================================================
// HANDLER ADMIN - VERSION FINALE CONFORME BDD
// =====================================================

import { Request, Response } from 'express'
import supabase from '../config/supabase'

export async function handleAdmin(req: Request, res: Response) {
  const { function: functionName, email, password, ...params } = req.body

  console.log(`[${new Date().toISOString()}] 🛠️ Admin: ${functionName} pour ${email}`);

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' })
  }

  try {
    // ========== AUTHENTIFICATION ==========
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password
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
      console.error(`⛔ Profil introuvable: ${authData.user.id}`)
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

    // ========== CAS SPÉCIAL : LOGIN ==========
    if (functionName === 'login') {
      return res.json({ 
        success: true, 
        user: { 
          id: profile.id, 
          nom: profile.nom, 
          prenom: profile.prenom, 
          role: normalizedRole 
        } 
      });
    }

    // ========== ROUTAGE DES FONCTIONS ==========
    switch (functionName) {
      case 'createSession': return await createSession(profile.id, params, res)
      case 'createParty': return await createParty(profile.id, params, res)
      case 'createRun': return await createRun(profile.id, params, res)
      case 'addQuestions': return await addQuestions(profile.id, params, res)
      case 'setVisibility': return await setVisibility(params, res)
      case 'closeRun': return await closeRun(params, res)
      case 'getStatistics': return await getStatistics(params, res)
      default:
        return res.status(400).json({ error: `Fonction inconnue: ${functionName}` })
    }

  } catch (error: any) {
    console.error(`💥 CRASH ADMIN:`, error)
    return res.status(500).json({ error: 'Erreur serveur', details: error.message })
  }
}

// ========== FONCTIONS MÉTIER ==========

async function createSession(_adminId: string, params: any, res: Response) {
  const { game_key, title, description, is_paid, price_cfa } = params
  
  if (!game_key || !title) {
    return res.status(400).json({ error: 'game_key et title requis' })
  }

  try {
    const { data: game } = await supabase
      .from('games')
      .select('id')
      .eq('key_name', game_key)
      .maybeSingle()

    if (!game) {
      return res.status(404).json({ error: 'Jeu non trouvé', game_key })
    }

    const { data, error } = await supabase
      .from('game_sessions')
      .insert({
        game_id: game.id,
        title,
        description: description || null,
        is_paid: !!is_paid,
        price_cfa: price_cfa || 0,
        created_by: _adminId
      })
      .select()
      .single()

    if (error) throw error

    console.log(`✅ Session créée: ${data.id}`)
    return res.json({ success: true, session_id: data.id, message: 'Session créée' })

  } catch (error: any) {
    console.error('ERROR createSession:', error)
    return res.status(500).json({ error: 'Erreur création session', details: error.message })
  }
}

async function createParty(_adminId: string, params: any, res: Response) {
  const { session_id, title, min_score, min_rank } = params
  
  if (!session_id || !title) {
    return res.status(400).json({ error: 'session_id et title requis' })
  }

  try {
    const { data, error } = await supabase
      .from('game_parties')
      .insert({
        session_id,
        title,
        is_initial: false,
        min_score: min_score || 0,
        min_rank: min_rank || null,
        created_by: _adminId
      })
      .select()
      .single()

    if (error) throw error

    console.log(`✅ Party créée: ${data.id}`)
    return res.json({ success: true, party_id: data.id, message: 'Party créée' })

  } catch (error: any) {
    console.error('ERROR createParty:', error)
    return res.status(500).json({ error: 'Erreur création party', details: error.message })
  }
}

async function createRun(_adminId: string, params: any, res: Response) {
  const { party_id, title } = params
  
  if (!party_id || !title) {
    return res.status(400).json({ error: 'party_id et title requis' })
  }

  try {
    const { data, error } = await supabase
      .from('game_runs')
      .insert({
        party_id,
        title,
        created_by: _adminId,
        is_visible: false,
        is_closed: false,
        is_started: false
      })
      .select()
      .single()

    if (error) throw error

    console.log(`✅ Run créé: ${data.id}`)
    return res.json({ success: true, run_id: data.id, message: 'Run créé' })

  } catch (error: any) {
    console.error('ERROR createRun:', error)
    return res.status(500).json({ error: 'Erreur création run', details: error.message })
  }
}

async function addQuestions(_adminId: string, params: any, res: Response) {
  const { run_id, questions } = params
  
  if (!run_id || !Array.isArray(questions)) {
    return res.status(400).json({ error: 'run_id et questions requis' })
  }

  try {
    const payload = questions.map((q: any) => ({
      run_id,
      question_text: q.question,
      correct_answer: !!q.answer,
      score: q.score || 10,
      created_by: _adminId
    }))

    const { data, error } = await supabase.from('run_questions').insert(payload).select()
    if (error) throw error

    console.log(`✅ ${data.length} questions ajoutées`)
    return res.json({ success: true, count: data.length, message: `${data.length} question(s) ajoutée(s)` })

  } catch (error: any) {
    console.error('ERROR addQuestions:', error)
    return res.status(500).json({ error: 'Erreur ajout questions', details: error.message })
  }
}

async function setVisibility(_params: any, res: Response) {
  const { run_id, visible } = _params
  
  if (!run_id || typeof visible !== 'boolean') {
    return res.status(400).json({ error: 'run_id et visible requis' })
  }

  try {
    const { error } = await supabase.rpc('set_run_visibility', {
      p_run_id: run_id,
      p_visible: visible
    })
    if (error) throw error

    console.log(`✅ Visibilité: ${visible}`)
    return res.json({ success: true, message: visible ? 'Run visible' : 'Run masqué' })

  } catch (error: any) {
    console.error('ERROR setVisibility:', error)
    return res.status(500).json({ error: 'Erreur visibilité', details: error.message })
  }
}

async function closeRun(_params: any, res: Response) {
  const { run_id, closed } = _params
  
  if (!run_id || typeof closed !== 'boolean') {
    return res.status(400).json({ error: 'run_id et closed requis' })
  }

  try {
    const { error } = await supabase.rpc('set_run_closed', {
      p_run_id: run_id,
      p_closed: closed
    })
    if (error) throw error

    console.log(`✅ Run ${closed ? 'fermé' : 'réouvert'}`)
    return res.json({ success: true, message: closed ? 'Run fermé' : 'Run réouvert' })

  } catch (error: any) {
    console.error('ERROR closeRun:', error)
    return res.status(500).json({ error: 'Erreur fermeture', details: error.message })
  }
}

async function getStatistics(_params: any, res: Response) {
  const { run_id } = _params
  
  if (!run_id) return res.status(400).json({ error: 'run_id requis' })

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(run_id)) {
    return res.status(400).json({ error: 'run_id invalide' })
  }

  try {
    const { data: run, error: runError } = await supabase
      .from('game_runs')
      .select('*')
      .eq('id', run_id)
      .maybeSingle()

    if (runError) throw runError
    if (!run) return res.status(404).json({ error: 'Run introuvable' })

    const { count: questionsCount } = await supabase
      .from('run_questions')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', run_id)

    const { count: answersCount } = await supabase
      .from('user_run_answers')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', run_id)

    const { count: playersCount } = await supabase
      .from('party_players')
      .select('*', { count: 'exact', head: true })
      .eq('party_id', run.party_id)

    return res.json({
      success: true,
      statistics: {
        id: run.id,
        title: run.title,
        is_visible: run.is_visible,
        is_closed: run.is_closed,
        is_started: run.is_started,
        total_questions: questionsCount || 0,
        total_answers: answersCount || 0,
        total_players: playersCount || 0
      }
    })

  } catch (error: any) {
    console.error('ERROR getStatistics:', error)
    return res.status(500).json({ error: 'Erreur stats', details: error.message })
  }
}
