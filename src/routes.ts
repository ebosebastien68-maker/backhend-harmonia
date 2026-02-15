// =====================================================
// ROUTES - HUB CENTRAL
// =====================================================
// Rôle : Diriger les requêtes vers les bons handlers
// =====================================================

import { Router, Request, Response } from 'express'
import { handleVraiFaux } from './handlers/vrai-faux'

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
// ROUTES PRINCIPALES
// =====================================================

// Route vrai-faux : /vrai-faux
router.post('/vrai-faux', handleVraiFaux)

// =====================================================
// ROUTES À VENIR (décommenter plus tard)
// =====================================================

// import { handleAdmin } from './handlers/admin'
// import { handleUser } from './handlers/user'

// Route admin : /admin
// router.post('/admin', handleAdmin)

// Route user : /user
// router.post('/user', handleUser)

// =====================================================
// EXPORT
// =====================================================

export default router
