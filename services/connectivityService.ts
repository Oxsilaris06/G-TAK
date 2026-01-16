import Peer, { DataConnection } from 'peerjs';
import { CONFIG } from '../constants';
import { UserData, OperatorRole, OperatorStatus, LogEntry, PingData } from '../types';

// TYPES D'ÉVÉNEMENTS EXPOSÉS
export type ConnectivityEvent = 
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEERS_UPDATED'; peers: Record<string, UserData> }
  | { type: 'HOST_CONNECTED'; hostId: string }
  | { type: 'DISCONNECTED'; reason: 'KICKED' | 'NO_HOST' | 'NETWORK_ERROR' | 'MANUAL' }
  | { type: 'RECONNECTING'; attempt: number }
  | { type: 'TOAST'; msg: string; level: 'info' | 'error' | 'success' }
  | { type: 'DATA_RECEIVED'; data: any; from: string };

type Listener = (event: ConnectivityEvent) => void;

// CONFIGURATION ROBUSTE INTERNE
// Ces délais gèrent la résilience de la couche application (au-dessus de WebRTC)
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 15; // Augmenté pour les zones à faible couverture
const HEARTBEAT_INTERVAL_MS = 3000;
const HEARTBEAT_TIMEOUT_MS = 10000; // Un peu plus tolérant (10s) pour les latences 4G/VPN

class ConnectivityService {
  private peer: Peer | null = null;
  private connections: Record<string, DataConnection> = {}; // Carte des connexions actives
  private peersMap: Record<string, UserData> = {}; // État des pairs connus
  private listeners: Listener[] = [];

  // État local
  private user: UserData | null = null;
  private hostId: string | null = null;
  private role: OperatorRole = OperatorRole.OPR;
  private targetHostId: string | null = null; // Pour reconnexion auto client

  // Gestion Reconnexion & Heartbeat
  private reconnectAttempts = 0;
  private isReconnecting = false;
  private heartbeatTimer: any = null;
  private lastHeartbeat: Record<string, number> = {}; // Timestamp dernier ping reçu
  private bannedPeers: Set<string> = new Set();

  // --- SINGLETON & ABONNEMENTS ---
  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private notify(event: ConnectivityEvent) {
    this.listeners.forEach(l => l(event));
  }

  // --- INITIALISATION ---
  public async init(user: UserData, role: OperatorRole, targetHostId?: string) {
    // Évite le re-init destructif si déjà connecté au bon endroit
    if (this.peer && !this.peer.destroyed && !this.peer.disconnected) {
        if (this.user?.role === role && (!targetHostId || this.hostId === targetHostId)) {
            console.log('[Connectivity] Already initialized correctly.');
            return;
        }
    }

    this.cleanup(false); // Nettoyage partiel
    this.user = { ...user, role };
    this.role = role;
    this.targetHostId = targetHostId || null;

    this.connectPeer();
  }

  private connectPeer() {
    const myId = this.role === OperatorRole.HOST ? this.generateShortId() : undefined;
    console.log(`[Connectivity] Creating Peer... Role: ${this.role}, ID: ${myId || 'Auto'}`);

    try {
        // Utilisation stricte de la config centralisée dans constants.ts
        // Cette config contient maintenant les serveurs STUN multiples et les optimisations ICE
        this.peer = new Peer(myId, CONFIG.PEER_CONFIG as any);

        this.setupPeerListeners();

    } catch (e) {
        console.error('[Connectivity] Peer Creation Failed:', e);
        this.handleError(new Error('Peer creation failed'));
    }
  }

  private setupPeerListeners() {
    if (!this.peer) return;

    this.peer.on('open', (id) => {
        console.log(`[Connectivity] Peer OPEN: ${id}`);
        this.reconnectAttempts = 0;
        this.isReconnecting = false;

        if (this.user) this.user.id = id;
        this.notify({ type: 'PEER_OPEN', id });

        if (this.role === OperatorRole.HOST) {
            this.hostId = id;
            this.peersMap[id] = this.user!;
            this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
            this.notify({ type: 'TOAST', msg: `SESSION HÔTE: ${id}`, level: 'success' });
            this.startHeartbeatLoop();
        } else if (this.targetHostId) {
            this.connectToHost(this.targetHostId);
        }
    });

    this.peer.on('connection', (conn) => {
        // Sécurité: Si banni, on ferme direct
        if (this.bannedPeers.has(conn.peer)) {
            console.warn(`[Connectivity] Blocked banned peer: ${conn.peer}`);
            conn.close();
            return;
        }
        this.handleIncomingConnection(conn);
    });

    this.peer.on('disconnected', () => {
        console.warn('[Connectivity] Peer Disconnected (Signal Server Lost)');
        // On ne détruit pas l'objet Peer, on tente juste de se reconnecter au serveur de signalisation
        if (!this.peer?.destroyed) {
            this.handleReconnect();
        }
    });

    this.peer.on('close', () => {
        console.warn('[Connectivity] Peer Closed (Destroyed)');
        this.cleanup(true); // Full cleanup
    });

    this.peer.on('error', (err: any) => {
        console.error(`[Connectivity] Peer Error: ${err.type}`, err);
        
        switch (err.type) {
            case 'peer-unavailable':
                this.notify({ type: 'TOAST', msg: 'Cible introuvable (Vérifiez ID)', level: 'error' });
                if (this.role === OperatorRole.OPR) {
                    this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
                }
                break;
            case 'unavailable-id':
                // Retry auto avec un nouvel ID aléatoire si collision
                this.notify({ type: 'TOAST', msg: 'ID non dispo, nouvel essai...', level: 'info' });
                setTimeout(() => this.connectPeer(), 1000); 
                break;
            case 'network':
            case 'webrtc':
            case 'server-error':
            case 'socket-error':
            case 'socket-closed':
                // Erreurs critiques de transport -> Reconnexion agressive
                this.handleReconnect();
                break;
            default:
                break;
        }
    });
  }

  // --- LOGIQUE DE RECONNEXION INTELLIGENTE ---
  private handleReconnect() {
      if (this.isReconnecting) return;
      
      // Si max tentatives atteintes, on déclare la mort réseau
      if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error('[Connectivity] Max reconnect attempts reached.');
          this.notify({ type: 'DISCONNECTED', reason: 'NETWORK_ERROR' });
          // On ne cleanup pas tout de suite, on laisse l'utilisateur réessayer manuellement via l'UI
          return;
      }

      this.isReconnecting = true;
      this.reconnectAttempts++;
      
      // Backoff exponentiel : 2s, 3s, 4.5s... plafonné à 15s
      const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(1.5, this.reconnectAttempts), 15000);

      console.log(`[Connectivity] Reconnecting in ${delay}ms (Attempt ${this.reconnectAttempts})...`);
      this.notify({ type: 'RECONNECTING', attempt: this.reconnectAttempts });

      setTimeout(() => {
          this.isReconnecting = false; // Reset flag pour permettre nouvelle tentative si celle-ci échoue
          if (this.peer && !this.peer.destroyed) {
              this.peer.reconnect();
          } else {
              // Si le peer est détruit, on le recrée complètement
              this.connectPeer();
          }
      }, delay);
  }

  // --- CONNEXION CLIENT -> HOST ---
  public connectToHost(targetId: string) {
      if (!this.peer || this.peer.destroyed) return;
      
      this.targetHostId = targetId;
      this.hostId = targetId;
      
      console.log(`[Connectivity] Connecting to Host: ${targetId}`);
      
      // Ferme l'ancienne connexion si elle existe pour éviter les doublons
      if (this.connections[targetId]) {
          this.connections[targetId].close();
          delete this.connections[targetId];
      }

      const conn = this.peer.connect(targetId, {
          reliable: true,
          serialization: 'json', // CRUCIAL pour compatibilité multi-plateforme
          metadata: { role: 'OPR', version: '3.3.0', platform: typeof navigator !== 'undefined' ? navigator.userAgent : 'native' }
      });

      this.setupDataConnection(conn);
  }

  // --- GESTION DES CONNEXIONS ENTRANTES/SORTANTES ---
  private handleIncomingConnection(conn: DataConnection) {
      console.log(`[Connectivity] Incoming connection from: ${conn.peer}`);
      
      conn.on('open', () => {
          // Si je suis HOST, j'envoie le state actuel immédiatement
          if (this.role === OperatorRole.HOST) {
              const peerList = Object.values(this.peersMap);
              conn.send({ type: 'SYNC', list: peerList });
          }
      });

      this.setupDataConnection(conn);
  }

  private setupDataConnection(conn: DataConnection) {
      this.connections[conn.peer] = conn;
      this.lastHeartbeat[conn.peer] = Date.now(); // Init heartbeat

      conn.on('data', (data: any) => {
          this.lastHeartbeat[conn.peer] = Date.now(); // Reset timeout sur réception de N'IMPORTE QUOI
          
          if (data && data.type === 'HEARTBEAT') {
              // Simple Keep-Alive, pas de traitement métier
              return; 
          }
          
          this.handleProtocolData(data, conn.peer);
      });

      conn.on('open', () => {
          console.log(`[Connectivity] Connection OPEN with ${conn.peer}`);
          
          if (this.role === OperatorRole.OPR && conn.peer === this.hostId) {
              this.notify({ type: 'HOST_CONNECTED', hostId: conn.peer });
              // Client envoie son profil complet dès que le tunnel est ouvert
              conn.send({ type: 'FULL', user: this.user });
              this.startHeartbeatLoop();
          }
      });

      conn.on('close', () => {
          console.log(`[Connectivity] Connection CLOSED with ${conn.peer}`);
          this.handlePeerDisconnection(conn.peer);
      });

      conn.on('error', (err) => {
          console.warn(`[Connectivity] Connection Error with ${conn.peer}:`, err);
          // On ne ferme pas tout de suite, WebRTC peut récupérer parfois.
          // Le Heartbeat fera le ménage si c'est vraiment mort.
      });
  }

  private handlePeerDisconnection(peerId: string) {
      delete this.connections[peerId];
      delete this.peersMap[peerId];
      delete this.lastHeartbeat[peerId];

      this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });

      if (this.role === OperatorRole.OPR && peerId === this.hostId) {
          console.warn('[Connectivity] Host Disconnected!');
          // Tentative de reconnexion automatique au Host
          if (this.targetHostId) {
             this.notify({ type: 'TOAST', msg: 'Connexion Hôte perdue, tentative...', level: 'error' });
             // On attend un peu avant de reconnecter pour laisser le temps au réseau de stabiliser
             setTimeout(() => this.connectToHost(this.targetHostId!), 1000);
          } else {
             this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
          }
      } else {
          // Si c'est juste un client qui part
          this.notify({ type: 'TOAST', msg: `${peerId} déconnecté`, level: 'info' });
      }
  }

  // --- TRAITEMENT PROTOCOLE MÉTIER ---
  private handleProtocolData(data: any, fromId: string) {
      // Filtrage sécu basique
      if (this.bannedPeers.has(fromId)) return;

      // Délègue à l'App pour la logique métier
      this.notify({ type: 'DATA_RECEIVED', data, from: fromId });

      switch (data.type) {
          case 'FULL': 
          case 'UPDATE': 
          case 'UPDATE_USER':
              if (data.user) {
                  this.peersMap[data.user.id] = data.user;
                  this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
              }
              break;
          
          case 'SYNC': 
              if (Array.isArray(data.list)) {
                  data.list.forEach((u: UserData) => {
                      if (u.id !== this.user?.id) this.peersMap[u.id] = u;
                  });
                  this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
              }
              break;
            
          case 'KICK':
              if (fromId === this.hostId) {
                  console.warn('[Connectivity] KICKED by Host');
                  this.cleanup(true);
                  this.notify({ type: 'DISCONNECTED', reason: 'KICKED' });
              }
              break;
      }
  }

  // --- ACTIONS ---
  public broadcast(data: any) {
      if (!this.user) return;
      const payload = { ...data, from: this.user.id };
      
      // Envoi à tous les pairs connectés
      Object.entries(this.connections).forEach(([peerId, conn]) => {
          if (conn.open) {
              try {
                  conn.send(payload);
              } catch(e) {
                  console.error(`Failed to send to ${peerId}`, e);
              }
          }
      });
  }

  public sendTo(targetId: string, data: any) {
      if (!this.user) return;
      const conn = this.connections[targetId];
      if (conn && conn.open) {
          try {
              conn.send({ ...data, from: this.user.id });
          } catch(e) {
               console.error(`Failed to send direct to ${targetId}`, e);
          }
      }
  }

  public kickUser(targetId: string, ban = false) {
      if (this.role !== OperatorRole.HOST) return;
      
      this.sendTo(targetId, { type: 'KICK' });
      
      if (ban) {
          this.bannedPeers.add(targetId);
      }
      
      // Fermeture brutale socket après envoi
      setTimeout(() => {
          const conn = this.connections[targetId];
          if (conn) conn.close();
          this.handlePeerDisconnection(targetId);
      }, 500);
  }

  // --- STATE UPDATERS ---
  public updateUserStatus(status: OperatorStatus) {
      if (!this.user) return;
      this.user.status = status;
      this.broadcast({ type: 'UPDATE', user: this.user });
      if (this.user.id) this.peersMap[this.user.id] = this.user;
      this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
  }

  public updateUserPosition(lat: number, lng: number, head: number) {
      if(!this.user) return;
      this.user.lat = lat;
      this.user.lng = lng;
      this.user.head = head;
      if(this.user.id) this.peersMap[this.user.id] = this.user;
      
      this.broadcast({ type: 'UPDATE', user: this.user });
  }

  public updateUser(partialUser: Partial<UserData>) {
      if (!this.user) return;
      this.user = { ...this.user, ...partialUser };
      if (this.user.id) this.peersMap[this.user.id] = this.user;
      this.broadcast({ type: 'UPDATE', user: this.user });
      this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
  }

  // --- HEARTBEAT SYSTEM (CRITIQUE POUR STABILITÉ) ---
  private startHeartbeatLoop() {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      
      this.heartbeatTimer = setInterval(() => {
          const now = Date.now();

          // 1. Envoyer Ping aux actifs
          Object.values(this.connections).forEach(conn => {
              if (conn.open) {
                  conn.send({ type: 'HEARTBEAT' });
              }
          });

          // 2. Vérifier Timeout
          Object.keys(this.connections).forEach(peerId => {
              const last = this.lastHeartbeat[peerId] || now;
              // Si silence radio > Timeout, on considère le lien mort
              if (now - last > HEARTBEAT_TIMEOUT_MS) {
                  console.warn(`[Connectivity] Peer Timeout: ${peerId} (Last seen: ${now - last}ms ago)`);
                  const conn = this.connections[peerId];
                  if (conn) conn.close(); // Force close
                  this.handlePeerDisconnection(peerId);
              }
          });

      }, HEARTBEAT_INTERVAL_MS);
  }

  private handleError(error: Error) {
      this.notify({ type: 'TOAST', msg: `Erreur Réseau: ${error.message}`, level: 'error' });
  }

  // --- CLEANUP ---
  public cleanup(full = true) {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;

      Object.values(this.connections).forEach(c => c.close());
      this.connections = {};
      this.peersMap = {};
      this.lastHeartbeat = {};

      if (this.peer) {
          this.peer.removeAllListeners();
          this.peer.destroy();
          this.peer = null;
      }
      
      this.hostId = null;
      this.targetHostId = null;
      
      if (full) {
          this.bannedPeers.clear();
      }
  }

  private generateShortId(): string {
      return Math.random().toString(36).substring(2, 10).toUpperCase();
  }
}

export const connectivityService = new ConnectivityService();
