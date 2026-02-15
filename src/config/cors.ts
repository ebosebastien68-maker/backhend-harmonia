// =====================================================
// CONFIGURATION CORS - VERSION PRODUCTION
// =====================================================

import { CorsOptions } from 'cors'

// En production uniquement
const allowedOrigins = ['https://harmonia-world.vercel.app']

// Configuration CORS
const corsConfig: CorsOptions = {
  origin: (origin, callback) => {
    // Autoriser les requêtes sans origin (Postman, curl)
    if (!origin) {
      return callback(null, true)
    }

    // Vérifier si l'origin est autorisée
    if (allowedOrigins.includes(origin)) {
      console.log(`✅ Origin autorisée: ${origin}`)
      callback(null, true)
    } else {
      console.warn(`⚠️  Origin BLOQUÉE: ${origin}`)
      console.warn(`   Origins autorisées:`, allowedOrigins)
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}

console.log('🔒 CORS configuré en PRODUCTION')
console.log('🔒 Origins autorisées:', allowedOrigins)

export default corsConfig
