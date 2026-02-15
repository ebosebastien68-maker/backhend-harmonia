// =====================================================
// CONFIGURATION CORS
// =====================================================
// Rôle : Autoriser uniquement certaines origines
//        (frontend) à appeler le backend
// =====================================================

import { CorsOptions } from 'cors'

// Récupérer les origines autorisées depuis .env
const allowedOriginsString = process.env.ALLOWED_ORIGINS || ''
const allowedOrigins = allowedOriginsString.split(',').map(origin => origin.trim())

// Origines par défaut si .env non défini
const defaultOrigins = [
  'https://harmonia-world.vercel.app',  // Production
  'http://localhost:8081',              // Expo dev
  'http://localhost:19006',             // Web dev
]

// Utiliser les origines définies ou les valeurs par défaut
const origins = allowedOrigins.length > 0 ? allowedOrigins : defaultOrigins

// Configuration CORS
const corsConfig: CorsOptions = {
  origin: (origin, callback) => {
    // Autoriser les requêtes sans origin (ex: Postman, curl)
    if (!origin) {
      return callback(null, true)
    }

    // Vérifier si l'origin est autorisée
    if (origins.includes(origin)) {
      callback(null, true)
    } else {
      console.warn(`⚠️  Origin non autorisée: ${origin}`)
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,  // Autoriser les cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}

// Log des origines autorisées (seulement en dev)
if (process.env.NODE_ENV === 'development') {
  console.log('✅ CORS configuré avec origines:', origins)
}

export default corsConfig
