import { OperatorStatus } from './types';

export const CONFIG = {
  // Clés de stockage
  SESSION_STORAGE_KEY: 'tacsuite_v1_session',
  TRIGRAM_STORAGE_KEY: 'tacsuite_v1_trigram',
  
  // Configuration PeerJS Optimisée
  PEER_CONFIG: {
    // Force le HTTPS pour le serveur de signalisation (CRITIQUE ANDROID)
    secure: true, 
    host: '0.peerjs.com', 
    port: 443,
    path: '/',
    
    debug: 2, // Niveau 2 pour voir les erreurs de connexion, 3 pour tout
    config: {
      iceServers: [
        // Google STUN (Standard)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        // Fallback port 443 (Souvent ouvert sur les pare-feux stricts)
        { urls: 'stun:stun.l.google.com:443' }
      ],
      iceCandidatePoolSize: 10,
    },
    // Désactive le ping PeerJS pour éviter les timeouts agressifs sur mobile
    pingInterval: 5000, 
  }
};

export const STATUS_COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',
  [OperatorStatus.CONTACT]: '#ef4444',
  [OperatorStatus.BUSY]: '#a855f7',
  [OperatorStatus.PROGRESSION]: '#3b82f6'
};
