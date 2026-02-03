import { OperatorStatus } from './types';

export const CONFIG = {
  // Clés de stockage
  SESSION_STORAGE_KEY: 'tacsuite_v1_session',
  TRIGRAM_STORAGE_KEY: 'tacsuite_v1_trigram',
  
  // Configuration PeerJS Optimisée & Stabilisée pour Android
  PEER_CONFIG: {
    secure: true, 
    host: '0.peerjs.com', 
    port: 443, 
    path: '/',
    
    // Debug level 1 pour éviter de spammer la console (cause de ralentissements)
    debug: 1, 
    
    config: {
      // CRITIQUE : iceCandidatePoolSize doit être à 0 sur React Native Android.
      // Une valeur > 0 provoque souvent l'erreur "Failed to initialize PeerConnection"
      iceCandidatePoolSize: 0, 
      
      iceServers: [
        // 1. Google - Le Standard (Port 19302 UDP)
        { urls: ['stun:stun.l.google.com:19302'] },

        // 2. Google - Variante (Port 53 UDP)
        // Passe souvent les pare-feux stricts (Anti-Firewall DNS)
        { urls: ['stun:stun.l.google.com:53'] },
        
        // 3. Google - Tentative Port 443 (Rarement UDP, mais peut aider sur certains réseaux)
        { urls: ['stun:stun.l.google.com:443'] },

        // 4. Twilio Public (Port 3478 UDP)
        { urls: ['stun:global.stun.twilio.com:3478'] },
        
        // 5. Stun Protocol
        { urls: ['stun:stun.stunprotocol.org:3478'] } 
      ],
    },
    
    // Ping agressif (10s) pour garantir la traversée NAT en mouvement
    // Note : Consomme plus de batterie, mais assure une meilleure résilience
    pingInterval: 10000, 
  }
};

export const STATUS_COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',
  [OperatorStatus.CONTACT]: '#ef4444',
  [OperatorStatus.BUSY]: '#a855f7',
  [OperatorStatus.PROGRESSION]: '#3b82f6'
};
