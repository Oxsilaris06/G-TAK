import { OperatorStatus } from './types';

export const CONFIG = {
  // Clés de stockage mises à jour pour TacSuite
  SESSION_STORAGE_KEY: 'tacsuite_v1_session',
  TRIGRAM_STORAGE_KEY: 'tacsuite_v1_trigram',
  
  // Configuration PeerJS (Serveurs STUN Google gratuits)
  PEER_CONFIG: {
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.l.google.com:443' },
        { urls: 'stun:stun1.l.google.com:443' },
      ],
    },
  }
};

export const STATUS_COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',
  [OperatorStatus.CONTACT]: '#ef4444',
  [OperatorStatus.BUSY]: '#a855f7', // Violet
  [OperatorStatus.PROGRESSION]: '#3b82f6' // Bleu
};
