import { OperatorStatus } from './types';

export const CONFIG = {
  // Clés de stockage
  SESSION_STORAGE_KEY: 'tacsuite_v1_session',
  TRIGRAM_STORAGE_KEY: 'tacsuite_v1_trigram',
  
  // Configuration PeerJS Optimisée pour Mobile (4G/5G/NATs stricts)
  PEER_CONFIG: {
    secure: true, 
    host: '0.peerjs.com', 
    port: 443, 
    path: '/',
    
    // Debug level 1 pour la prod (erreurs critiques uniquement)
    debug: 1, 
    
    config: {
      // Optimisation: Ne pas bloquer l'initialisation sur mobile
      iceCandidatePoolSize: 1, // Garder à 1 ou 2 max sur mobile sans TURN pour éviter le lag au démarrage
      
      iceServers: [
        // 1. Google - Le Standard (Port 19302 UDP)
        // Très rapide, fonctionne sur la majorité des routeurs domestiques
        { urls: 'stun:stun.l.google.com:19302' },

        // 2. Google - Variante (Port 53 UDP)
        // Le port 53 est réservé au DNS. Souvent laissé ouvert sur les
        // pare-feux stricts (hôtels, aéroports, 4G entreprise) qui bloquent les ports hauts.
        { urls: 'stun:stun.l.google.com:53' },

        // 3. Twilio Public - Redondance (Port 3478 UDP)
        // Utilise le port standard STUN alternatif. Utile si les IPs Google sont throttlées.
        { urls: 'stun:global.stun.twilio.com:3478?transport=udp' },
        
        // 4. Stun Protocol - Repli Port 80 (TCP/UDP)
        // Tentative de passer pour du trafic web si tout le reste échoue.
        { urls: 'stun:stun.stunprotocol.org:3478' } 
      ],
    },
    
    // Ping plus espacé pour économiser la batterie et la data en 4G
    // 25s est suffisant pour maintenir le NAT mapping UDP actif (Timeout moyen ~30s-60s)
    pingInterval: 15000, 
  }
};

export const STATUS_COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',
  [OperatorStatus.CONTACT]: '#ef4444',
  [OperatorStatus.BUSY]: '#a855f7',
  [OperatorStatus.PROGRESSION]: '#3b82f6'
};
