// =====================================================
// HARMONIA BACKEND - POINT D'ENTRÉE
// =====================================================
// Rôle : Ouvrir le port, installer les middlewares,
//        charger les routes, démarrer le serveur
// =====================================================

import express, { Request, Response } from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import corsConfig from './src/config/cors'
import routes from './src/routes'

// Charger les variables d'environnement
dotenv.config()

// Créer l'application Express
const app = express()
const PORT = process.env.PORT || 3000
const NODE_ENV = process.env.NODE_ENV || 'development'

// =====================================================
// MIDDLEWARES GLOBAUX
// =====================================================

// CORS : Autoriser le frontend à appeler le backend
app.use(cors(corsConfig))

// Parser JSON : Lire req.body en JSON
app.use(express.json())

// Parser URL-encoded : Lire les formulaires
app.use(express.urlencoded({ extended: true }))

// Logger basique : Afficher chaque requête
app.use((req: Request, res: Response, next) => {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${req.method} ${req.path}`)
  next()
})

// =====================================================
// ROUTES
// =====================================================

// Route de santé (test connexion)
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: '🚀 Backend Harmonia is alive!',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV
  })
})

// Charger toutes les routes depuis src/routes.ts
app.use('/', routes)

// Route 404 (si aucune route ne correspond)
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Route non trouvée',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  })
})

// =====================================================
// GESTION DES ERREURS GLOBALES
// =====================================================

app.use((err: Error, req: Request, res: Response, next: any) => {
  console.error(`[${new Date().toISOString()}] ERROR:`, err)
  
  res.status(500).json({
    error: 'Erreur serveur',
    details: NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString()
  })
})

// =====================================================
// DÉMARRAGE DU SERVEUR
// =====================================================

app.listen(PORT, () => {
  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('🚀 BACKEND HARMONIA DÉMARRÉ')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`📍 Port       : ${PORT}`)
  console.log(`🌍 Environment: ${NODE_ENV}`)
  console.log(`🔗 URL        : http://localhost:${PORT}`)
  console.log(`✅ Health     : http://localhost:${PORT}/health`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')
})

// =====================================================
// GESTION ARRÊT GRACIEUX
// =====================================================

process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM reçu, arrêt du serveur...')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('⚠️  SIGINT reçu, arrêt du serveur...')
  process.exit(0)
})
