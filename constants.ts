import { OperatorStatus } from './types';

export const CONFIG = {
  // Clés de stockage
  SESSION_STORAGE_KEY: 'tacsuite_v1_session',
  TRIGRAM_STORAGE_KEY: 'tacsuite_v1_trigram',
  
  // Configuration PeerJS Optimisée & Stabilisée pour Android/Mobile
  PEER_CONFIG: {
    secure: true, 
    host: '0.peerjs.com', 
    port: 443, 
    path: '/',
    
    debug: 1, // Garder 1 pour éviter les logs excessifs qui bloquent le thread JS
    
    config: {
      // CRITIQUE : iceCandidatePoolSize doit être à 0 sur React Native Android.
      iceCandidatePoolSize: 0, 
      
      iceServers: [
        // 1. PRIORITÉ ABSOLUE : Google Port 53 (UDP)
        // Le port 53 est celui du DNS, presque jamais bloqué ou bridé par les opérateurs 4G/5G.
        // C'est la clé pour une connexion rapide sur mobile sans TURN.
        { urls: ['stun:stun.l.google.com:53'] },

        // 2. Google Standard (Port 19302)
        // Fallback standard très robuste.
        { urls: ['stun:stun.l.google.com:19302'] },

        // 3. Twilio (Port 3478)
        // Bonne alternative si Google est lent dans la région.
        { urls: ['stun:global.stun.twilio.com:3478'] }
      ],
    },
    
    // Ping plus agressif (10s au lieu de 25s)
    // Les NATs des opérateurs mobiles (CGNAT) ferment les ports inactifs très vite.
    // 10s assure que le tunnel reste ouvert même en 5G statique.
    pingInterval: 10000, 
  }
};

export const STATUS_COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',
  [OperatorStatus.CONTACT]: '#ef4444',
  [OperatorStatus.BUSY]: '#a855f7',
  [OperatorStatus.PROGRESSION]: '#3b82f6'
};
