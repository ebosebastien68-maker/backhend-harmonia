// =====================================================
// ROUTES - HUB CENTRAL
// =====================================================
// Rôle : Diriger les requêtes vers les bons handlers
//        selon le chemin appelé
// =====================================================

import { Router, Request, Response } from 'express'

// Créer le routeur Express
const router = Router()

// =====================================================
// ROUTE TEST (pour vérifier que le routing fonctionne)
// =====================================================

router.post('/test', (req: Request, res: Response) => {
  const { message } = req.body
  
  console.log(`[${new Date().toISOString()}] Route /test appelée`)
  
  res.json({
    success: true,
    message: 'Route test fonctionne !',
    received: message || 'Aucun message reçu',
    timestamp: new Date().toISOString()
  })
})

// =====================================================
// ROUTES PRINCIPALES (À DÉCOMMENTER PLUS TARD)
// =====================================================

// import { handleGame } from './handlers/game'
// import { handleAdmin } from './handlers/admin'
// import { handleUser } from './handlers/user'

// Route jeu : /game
// router.post('/game', handleGame)

// Route admin : /admin
// router.post('/admin', handleAdmin)

// Route user : /user
// router.post('/user', handleUser)

// =====================================================
// EXPORT
// =====================================================

export default router
