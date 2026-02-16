// =====================================================
// HANDLER ADMIN - COMPLET AVEC SESSIONS + PARTIES
// =====================================================

import { Request, Response } from 'express'
import supabase from '../config/supabase'
import crypto from 'crypto'

export async function handleAdmin(req: Request, res: Response) {
  const { function: functionName, email, password, ...params } = req.body

  console.log(`[${new Date().toISOString()}] admin/${functionName}`)

  // ========== ÉTAPE 1 : VÉRIFIER EMAIL + MOT DE PASSE ==========
  
  if (!email || !password) {
    return res.status(401).json({
      error: 'Email et mot de passe requis',
      timestamp: new Date().toISOString()
    })
  }

  try {
    // Hash SHA-256
    const hashedPassword = crypto
      .createHash('sha256')
      .update(password)
      .digest('hex')

    // Récupérer le profil
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

    // Vérifier le mot de passe
    if (profile.password_hash !== hashedPassword) {
      console.warn(`⚠️  Mot de passe incorrect pour: ${email}`)
      return res.status(401).json({
        error: 'Email ou mot de passe incorrect',
        timestamp: new Date().toISOString()
      })
    }

    console.log(`✅ Auth: ${profile.nom} ${profile.prenom} (${profile.role})`)

    // ========== ÉTAPE 2 : VÉRIFIER LE RÔLE ==========

    const allowedRoles = ['admin', 'adminpro', 'supreme']
    const rejectedRoles = ['user', 'userpro']

    if (rejectedRoles.includes(profile.role)) {
      console.warn(`⚠️  Accès refusé - Role: ${profile.role}`)
      return res.status(403).json({
        error: 'Accès refusé : rôle insuffisant',
        details: `Votre rôle (${profile.role}) ne permet pas d'accéder aux fonctions admin`,
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

    // ========== ÉTAPE 3 : EXÉCUTER LA FONCTION ==========

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
        return await setVisibility(profile.id, params, res)
      case 'closeRun':
        return await closeRun(profile.id, params, res)
      case 'getStatistics':
        return await getStatistics(profile.id, params, res)
      default:
        return res.status(400).json({
          error: 'Fonction inconnue',
          available: [
            'createSession',
            'createParty',
            'createRun',
            'addQuestions',
            'setVisibility',
            'closeRun',
            'getStatistics'
          ],
          timestamp: new Date().toISOString()
        })
    }

  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ERROR handleAdmin:`, error)
    return res.status(500).json({
      error: 'Erreur serveur',
      details: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

// ========== FONCTIONS ADMIN ==========

async function createSession(adminId: string, params: any, res: Response) {
  try {
    const { game_key, title, description, is_paid, price_cfa } = params

    if (!game_key || !title) {
      return res.status(400).json({ 
        error: 'game_key et title requis',
        timestamp: new Date().toISOString()
      })
    }

    console.log(`[${new Date().toISOString()}] createSession`, { game_key, title })

    // Récupérer le game_id depuis le game_key
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('id')
      .eq('key_name', game_key)
      .single()

    if (gameError || !game) {
      return res.status(404).json({ 
        error: 'Jeu non trouvé',
        game_key,
        timestamp: new Date().toISOString()
      })
    }

    // Créer la session
    const { data: session, error: sessionError } = await supabase
      .from('game_sessions')
      .insert({
        game_id: game.id,
        title,
        description: description || null,
        is_paid: is_paid || false,
        price_cfa: price_cfa || 0,
        created_by: adminId
      })
      .select()
      .single()

    if (sessionError) throw sessionError

    console.log(`✅ Session créée: ${session.id}`)

    return res.json({
      success: true,
      session_id: session.id,
      session,
      message: 'Session créée avec succès',
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ERROR createSession:`, error)
    return res.status(500).json({ 
      error: 'Erreur création session', 
      details: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

async function createParty(adminId: string, params: any, res: Response) {
  try {
    const { session_id, title, min_score, min_rank } = params

    if (!session_id || !title) {
      return res.status(400).json({ 
        error: 'session_id et title requis',
        timestamp: new Date().toISOString()
      })
    }

    console.log(`[${new Date().toISOString()}] createParty`, { session_id, title })

    // Appeler la fonction RPC Supabase
    const { data, error } = await supabase.rpc('create_party_for_session', {
      p_session_id: session_id,
      p_title: title,
      p_min_score: min_score || null,
      p_min_rank: min_rank || null
    })

    if (error) throw error

    console.log(`✅ Party créée: ${data}`)

    return res.json({
      success: true,
      party_id: data,
      message: 'Party créée avec succès',
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ERROR createParty:`, error)
    return res.status(500).json({ 
      error: 'Erreur création party', 
      details: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

async function createRun(adminId: string, params: any, res: Response) {
  try {
    const { party_id, title } = params
    if (!party_id || !title) {
      return res.status(400).json({ 
        error: 'party_id et title requis',
        timestamp: new Date().toISOString()
      })
    }

    console.log(`[${new Date().toISOString()}] createRun`, { party_id, title })

    const { data, error } = await supabase.rpc('create_run', {
      p_party_id: party_id,
      p_title: title
    })
    if (error) throw error

    console.log(`✅ Run créé: ${data}`)

    return res.json({
      success: true,
      run_id: data,
      message: 'Run créé avec succès',
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ERROR createRun:`, error)
    return res.status(500).json({ 
      error: 'Erreur création run', 
      details: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

async function addQuestions(adminId: string, params: any, res: Response) {
  try {
    const { run_id, questions } = params
    if (!run_id || !Array.isArray(questions)) {
      return res.status(400).json({ 
        error: 'run_id et questions (array) requis',
        timestamp: new Date().toISOString()
      })
    }

    console.log(`[${new Date().toISOString()}] addQuestions`, {
      run_id,
      count: questions.length
    })

    const questionsToInsert = questions.map((q: any) => ({
      run_id,
      question_text: q.question,
      correct_answer: q.answer,
      score: q.score || 10,
      created_by: adminId
    }))

    const { data, error } = await supabase
      .from('run_questions')
      .insert(questionsToInsert)
      .select()
    if (error) throw error

    console.log(`✅ Questions ajoutées: ${data.length}`)

    return res.json({
      success: true,
      questions_added: data.length,
      questions: data,
      message: `${data.length} question(s) ajoutée(s)`,
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ERROR addQuestions:`, error)
    return res.status(500).json({ 
      error: 'Erreur ajout questions', 
      details: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

async function setVisibility(adminId: string, params: any, res: Response) {
  try {
    const { run_id, visible } = params
    if (!run_id || typeof visible !== 'boolean') {
      return res.status(400).json({ 
        error: 'run_id et visible (boolean) requis',
        timestamp: new Date().toISOString()
      })
    }

    console.log(`[${new Date().toISOString()}] setVisibility`, { run_id, visible })

    const { error } = await supabase.rpc('set_run_visibility', {
      p_run_id: run_id,
      p_visible: visible
    })
    if (error) throw error

    console.log(`✅ Visibilité modifiée: ${visible}`)

    return res.json({
      success: true,
      message: visible ? 'Run rendu visible' : 'Run masqué',
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ERROR setVisibility:`, error)
    return res.status(500).json({ 
      error: 'Erreur modification visibilité', 
      details: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

async function closeRun(adminId: string, params: any, res: Response) {
  try {
    const { run_id, closed } = params
    if (!run_id || typeof closed !== 'boolean') {
      return res.status(400).json({ 
        error: 'run_id et closed (boolean) requis',
        timestamp: new Date().toISOString()
      })
    }

    console.log(`[${new Date().toISOString()}] closeRun`, { run_id, closed })

    const { error } = await supabase.rpc('set_run_closed', {
      p_run_id: run_id,
      p_closed: closed
    })
    if (error) throw error

    console.log(`✅ Run ${closed ? 'fermé' : 'réouvert'}`)

    return res.json({
      success: true,
      message: closed ? 'Run fermé' : 'Run réouvert',
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ERROR closeRun:`, error)
    return res.status(500).json({ 
      error: 'Erreur fermeture run', 
      details: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

async function getStatistics(adminId: string, params: any, res: Response) {
  try {
    const { run_id } = params
    if (!run_id) {
      return res.status(400).json({ 
        error: 'run_id requis',
        timestamp: new Date().toISOString()
      })
    }

    console.log(`[${new Date().toISOString()}] getStatistics`, { run_id })

    const { data: run, error: runError } = await supabase
      .from('game_runs')
      .select('*, game_parties(session_id, party_id:id)')
      .eq('id', run_id)
      .single()
    if (runError) throw runError

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
    console.error(`[${new Date().toISOString()}] ERROR getStatistics:`, error)
    return res.status(500).json({ 
      error: 'Erreur récupération statistiques', 
      details: error.message,
      timestamp: new Date().toISOString()
    })
  }
}
        
