import { OperatorStatus } from './types';

export const CONFIG = {
  // Clés de stockage (Mise à jour v18 selon instructions)
  SESSION_STORAGE_KEY: 'comtac_v18_session',
  TRIGRAM_STORAGE_KEY: 'comtac_v18_trigram',
  
  // Configuration PeerJS
  // Utilise les serveurs STUN de Google (Ports 19302 et 443) pour traverser le NAT sans serveur TURN
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
  },
  
  // Seuil de détection vocale
  VAD_THRESHOLD: 0.02,
};

export const STATUS_COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',
  [OperatorStatus.CONTACT]: '#ef4444',
  [OperatorStatus.BUSY]: '#a855f7',
  [OperatorStatus.APPUI]: '#eab308',
  [OperatorStatus.PROGRESSION]: '#3b82f6'
};
