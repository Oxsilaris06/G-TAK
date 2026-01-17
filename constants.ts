import { OperatorStatus } from './types';

export const CONFIG = {
  // Clés de stockage
  SESSION_STORAGE_KEY: 'tacsuite_v1_session',
  TRIGRAM_STORAGE_KEY: 'tacsuite_v1_trigram',
  
  // Configuration PeerJS Optimisée (Basée sur comtac.html qui fonctionne)
  PEER_CONFIG: {
    debug: 1, // Niveau de log réduit pour prod (1=Errors)
    config: {
      iceServers: [
        // Configuration Google STUN standard (UDP)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        
        // Configuration Google STUN port 443 (TCP/UDP - Passe-muraille pour réseaux restreints)
        { urls: 'stun:stun.l.google.com:443' },
        { urls: 'stun:stun1.l.google.com:443' },
      ],
    },
    // Désactive le ping interne de PeerJS qui est moins fiable que notre heartbeat custom
    pingInterval: 5000, 
  }
};

export const STATUS_COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',
  [OperatorStatus.CONTACT]: '#ef4444',
  [OperatorStatus.BUSY]: '#a855f7', // Violet
  [OperatorStatus.PROGRESSION]: '#3b82f6' // Bleu
};
