// =====================================================
// ROUTES - HUB CENTRAL
// =====================================================

import { Router, Request, Response } from 'express'
import { handleGame } from './handlers/game'
import { handleAdmin } from './handlers/admin'

const router = Router()

// =====================================================
// ROUTE TEST
// =====================================================

router.post('/test', (req: Request, res: Response) => {
  const { message } = req.body
  console.log(`[${new Date().toISOString()}] Route /test`)
  res.json({
    success: true,
    message: 'Route test fonctionne !',
    received: message || 'Aucun message',
    timestamp: new Date().toISOString()
  })
})

// =====================================================
// ROUTES PRINCIPALES
// =====================================================

// Route jeu (joueurs)
router.post('/game', handleGame)

// Route admin
router.post('/admin', handleAdmin)

// =====================================================
// EXPORT
// =====================================================

export default router
    
