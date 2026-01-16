import { OperatorStatus } from './types';

export const CONFIG = {
  // Clés de stockage
  SESSION_STORAGE_KEY: 'tacsuite_v1_session',
  TRIGRAM_STORAGE_KEY: 'tacsuite_v1_trigram',
  
  // Configuration PeerJS Optimisée pour Mobilité & NAT Difficiles
  PEER_CONFIG: {
    debug: 2, // 0: None, 1: Errors, 2: Warnings, 3: All
    secure: true, // Utiliser SSL pour la signalisation (évite certains blocages proxy)
    config: {
      // Stratégie de transport : 'all' permet P2P direct (STUN) et Relais (TURN) si dispo
      iceTransportPolicy: 'all', 
      
      // Taille du pool de candidats pour accélérer la connexion initiale
      iceCandidatePoolSize: 10,
      
      // Liste étendue de serveurs STUN pour maximiser les chances de traversée NAT
      iceServers: [
        // Google STUN (Port standard)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        
        // Google STUN (Port alternatif 443 pour passer les pare-feu stricts web)
        // Utile si le port UDP 19302 est bloqué (fréquent en WiFi public/entreprise)
        { urls: 'stun:stun.l.google.com:443' },
        { urls: 'stun:stun1.l.google.com:443' },
        
        // Serveurs alternatifs (Redondance si Google est inaccessible dans certaines régions/VPN)
        { urls: 'stun:stun.services.mozilla.com' },
        { urls: 'stun:global.stun.twilio.com:3478' }
        
        /* NOTE SUR LA GARANTIE 100% :
           Pour garantir la connexion derrière des NAT symétriques stricts (certaines 4G ou réseaux d'entreprise),
           l'ajout d'un serveur TURN est OBLIGATOIRE. STUN seul ne suffit pas dans ~15% des cas.
           
           Exemple de config TURN (à décommenter si vous avez un serveur coturn ou un service payant) :
           {
             urls: 'turn:votre-serveur-turn.com:3478',
             username: 'user',
             credential: 'password'
           }
        */
      ],
    },
    // Optimisation mobile : désactive la détection ping du serveur de signalisation 
    // qui peut échouer sur des changements de réseau rapides (4G <-> WiFi)
    pingInterval: 5000, 
  }
};

export const STATUS_COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',
  [OperatorStatus.CONTACT]: '#ef4444',
  [OperatorStatus.BUSY]: '#a855f7', // Violet
  [OperatorStatus.PROGRESSION]: '#3b82f6' // Bleu
};
