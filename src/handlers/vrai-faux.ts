// =====================================================
// HANDLER VRAI OU FAUX - TEST
// =====================================================
// Rôle : Renvoyer un message texte au frontend
// =====================================================

import { Request, Response } from 'express'

export async function handleVraiFaux(req: Request, res: Response) {
  const { function: functionName } = req.body

  console.log(`[${new Date().toISOString()}] vrai-faux/${functionName}`)

  // Redirection vers la bonne fonction
  switch (functionName) {
    case 'getMessage':
      return getMessage(res)
    
    case 'testConnection':
      return testConnection(res)
    
    default:
      return res.status(400).json({
        error: 'Fonction inconnue',
        available: ['getMessage', 'testConnection'],
        timestamp: new Date().toISOString()
      })
  }
}

// ========== FONCTIONS ==========

function getMessage(res: Response) {
  const messages = [
    '🎮 Le jeu Vrai ou Faux arrive bientôt !',
    '🚀 Backend Harmonia connecté avec succès !',
    '✨ La communication fonctionne parfaitement !',
    '🎯 Préparez-vous pour des questions passionnantes !',
    '🔥 Le système est opérationnel !'
  ]

  // Message aléatoire
  const randomMessage = messages[Math.floor(Math.random() * messages.length)]

  return res.json({
    success: true,
    message: randomMessage,
    timestamp: new Date().toISOString(),
    from: 'Backend Harmonia Production'
  })
}

function testConnection(res: Response) {
  return res.json({
    success: true,
    message: '✅ Connexion au backend réussie !',
    backend_url: 'https://backend-harmonia.onrender.com',
    status: 'online',
    timestamp: new Date().toISOString()
  })
}
