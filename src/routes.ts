// =====================================================
// ROUTES - HUB CENTRAL
// =====================================================

import { Router, Request, Response } from 'express'
import { handleGame }  from './handlers/game'
import { handleAdmin } from './handlers/admin'

const router = Router()

// =====================================================
// HEALTH CHECK
// =====================================================

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status:    'ok',
    service:   'Harmonia API',
    timestamp: new Date().toISOString(),
  })
})

// =====================================================
// ROUTE TEST
// =====================================================

router.post('/test', (req: Request, res: Response) => {
  const { message } = req.body
  console.log(`[${new Date().toISOString()}] Route /test`)
  res.json({
    success:   true,
    message:   'Route test fonctionne !',
    received:  message || 'Aucun message',
    timestamp: new Date().toISOString(),
  })
})

// =====================================================
// ROUTES PRINCIPALES
// =====================================================

// Route jeu (joueurs)
// Fonctions disponibles :
//   listSessions, listPartiesForSession, joinSession
//   listVisibleRuns, getQuestions, submitAnswer
//   getLeaderboard, getPartyHistory
router.post('/game', (req: Request, res: Response) => {
  const fn = req.body?.function || '?'
  console.log(`[${new Date().toISOString()}] /game → ${fn}`)
  return handleGame(req, res)
})

// Route admin (authentifiée par email/password)
// Fonctions disponibles :
//   createSession, createParty, createRun, addQuestions
//   setStarted, setVisibility, closeRun, getStatistics
//   listSessions, listParties, listRuns, listRunQuestions
//   getPartyPlayers
//   deleteSession, deleteParty, deleteRun, deleteQuestion
router.post('/admin', (req: Request, res: Response) => {
  const fn = req.body?.function || '?'
  console.log(`[${new Date().toISOString()}] /admin → ${fn}`)
  return handleAdmin(req, res)
})

// =====================================================
// 404 — Route inconnue
// =====================================================

router.use((_req: Request, res: Response) => {
  res.status(404).json({
    error:   'Route non trouvée',
    message: 'Les routes disponibles sont : GET /health, POST /test, POST /game, POST /admin',
  })
})

// =====================================================
// EXPORT
// =====================================================

export default router
