import { Request, Response } from 'express'
import supabase from '../config/supabase'

export async function handleAdmin(req: Request, res: Response) {
  const { function: functionName, email, password, ...params } = req.body

  console.log(`[${new Date().toISOString()}] 🛠️ Requête Admin: ${functionName} pour ${email}`);

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis' })
  }

  try {
    // =====================================================
    // ÉTAPE 1 : AUTHENTIFICATION
    // =====================================================
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password
    })

    if (authError || !authData.user) {
      console.warn(`⛔ Auth échouée: ${authError?.message}`)
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' })
    }

    // =====================================================
    // ÉTAPE 2 : VÉRIFICATION DU RÔLE + DIAGNOSTIC RENDER
    // =====================================================
    
    // Diagnostic : On vérifie si le serveur a accès à la table en lecture générale
    const { count: totalProfilesVisible } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    // Récupération du profil précis
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, role, nom, prenom')
      .eq('id', authData.user.id)
      .maybeSingle()

    // Logs de diagnostic pour tes logs Render
    console.log(`[DIAGNOSTIC RENDER] UID Authentifié: ${authData.user.id}`);
    console.log(`[DIAGNOSTIC RENDER] Profils accessibles au total: ${totalProfilesVisible ?? 0}`);

    if (profileError) {
      console.error(`❌ Erreur SQL Supabase:`, profileError.message);
      return res.status(500).json({ error: 'Erreur SQL', details: profileError.message });
    }

    if (!profile) {
      console.error(`⛔ Profil introuvable pour l'UID: ${authData.user.id}`);
      return res.status(403).json({ 
        error: 'Accès refusé : Profil inexistant dans la table',
        debug: {
          uid_tente: authData.user.id,
          total_visibles: totalProfilesVisible ?? 0,
          message: "Si total_visibles est 0, votre SERVICE_ROLE_KEY sur Render ne fonctionne pas ou la RLS bloque."
        }
      })
    }

    // =====================================================
    // ÉTAPE 3 : NORMALISATION DU RÔLE
    // =====================================================
    const rawRole = profile.role;
    const normalizedRole = rawRole?.toString().toLowerCase().trim();
    const allowedRoles = ['admin', 'adminpro', 'supreme'];

    console.log(`[DEBUG AUTH] Rôle brut: "${rawRole}" | Rôle normalisé: "${normalizedRole}"`);

    if (!normalizedRole || !allowedRoles.includes(normalizedRole)) {
      console.warn(`⛔ Accès refusé. Rôle "${normalizedRole}" non autorisé.`);
      return res.status(403).json({ 
        error: 'Droits insuffisants',
        votre_role: normalizedRole
      })
    }

    console.log(`✅ Accès validé pour ${profile.prenom} (${normalizedRole})`)

    // =====================================================
    // ÉTAPE 4 : ROUTAGE DES FONCTIONS (Switch)
    // =====================================================
    switch (functionName) {
      case 'createSession': return await createSession(profile.id, params, res)
      case 'createParty':   return await createParty(profile.id, params, res)
      case 'createRun':     return await createRun(profile.id, params, res)
      case 'addQuestions':  return await addQuestions(profile.id, params, res)
      case 'setVisibility': return await setVisibility(params, res)
      case 'closeRun':      return await closeRun(params, res)
      case 'getStatistics': return await getStatistics(params, res)
      default:
        return res.status(400).json({ error: `Fonction inconnue: ${functionName}` })
    }

  } catch (error: any) {
    console.error(`💥 CRASH SERVEUR:`, error)
    return res.status(500).json({ error: 'Erreur serveur', details: error.message })
  }
}

// Les fonctions métier (createSession, etc.) restent les mêmes en dessous...
    
