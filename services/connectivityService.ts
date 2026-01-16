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

// CONFIGURATION ROBUSTE
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10; // Plus agressif
const HEARTBEAT_INTERVAL_MS = 3000;
const HEARTBEAT_TIMEOUT_MS = 8000; // Si pas de réponse en 8s, on considère mort
const BANNED_PEERS_KEY = 'tacsuite_banned_peers'; // Pourrait être persisté si besoin

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

    this.cleanup(false); // Nettoyage partiel (garde pas les bans si on veut, ici on reset sauf ban)
    this.user = { ...user, role };
    this.role = role;
    this.targetHostId = targetHostId || null;

    this.connectPeer();
  }

  private connectPeer() {
    const myId = this.role === OperatorRole.HOST ? this.generateShortId() : undefined;
    console.log(`[Connectivity] Creating Peer... Role: ${this.role}, ID: ${myId || 'Auto'}`);

    try {
        // Configuration PeerJS optimisée pour mobile
        this.peer = new Peer(myId, {
            ...CONFIG.PEER_CONFIG,
            debug: 2, // Niv 2: Warnings & Errors. Niv 3: All logs
            secure: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    // Ajouter un serveur TURN ici pour une vraie prod hors LAN si NAT strict
                ],
                iceTransportPolicy: 'all', // 'relay' forcerait TURN, 'all' permet STUN (P2P direct)
            }
        } as any);

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
                this.notify({ type: 'TOAST', msg: 'Hôte introuvable / hors ligne', level: 'error' });
                if (this.role === OperatorRole.OPR) {
                    this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
                }
                break;
            case 'unavailable-id':
                this.notify({ type: 'TOAST', msg: 'ID Session indisponible (déjà pris ?)', level: 'error' });
                break;
            case 'network':
            case 'webrtc':
                this.handleReconnect();
                break;
            default:
                // Erreurs mineures ou fatales
                break;
        }
    });
  }

  // --- LOGIQUE DE RECONNEXION INTELLIGENTE ---
  private handleReconnect() {
      if (this.isReconnecting) return;
      if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          console.error('[Connectivity] Max reconnect attempts reached.');
          this.notify({ type: 'DISCONNECTED', reason: 'NETWORK_ERROR' });
          this.cleanup(true);
          return;
      }

      this.isReconnecting = true;
      this.reconnectAttempts++;
      const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(1.5, this.reconnectAttempts), 10000);

      console.log(`[Connectivity] Reconnecting in ${delay}ms (Attempt ${this.reconnectAttempts})...`);
      this.notify({ type: 'RECONNECTING', attempt: this.reconnectAttempts });

      setTimeout(() => {
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
      
      // Ferme l'ancienne connexion si elle existe
      if (this.connections[targetId]) {
          this.connections[targetId].close();
          delete this.connections[targetId];
      }

      const conn = this.peer.connect(targetId, {
          reliable: true,
          serialization: 'json', // Plus compatible que binary
          metadata: { role: 'OPR', version: '3.3.0' }
      });

      this.setupDataConnection(conn);
  }

  // --- GESTION DES CONNEXIONS ENTRANTES/SORTANTES ---
  private handleIncomingConnection(conn: DataConnection) {
      console.log(`[Connectivity] Incoming connection from: ${conn.peer}`);
      
      conn.on('open', () => {
          // Si je suis HOST, j'envoie le state actuel
          if (this.role === OperatorRole.HOST) {
              const peerList = Object.values(this.peersMap);
              conn.send({ type: 'SYNC', list: peerList });
              // SYNC_PINGS et SYNC_LOGS sont envoyés par App.tsx sur réception du 'FULL'
          }
      });

      this.setupDataConnection(conn);
  }

  private setupDataConnection(conn: DataConnection) {
      this.connections[conn.peer] = conn;
      this.lastHeartbeat[conn.peer] = Date.now(); // Init heartbeat

      conn.on('data', (data: any) => {
          this.lastHeartbeat[conn.peer] = Date.now(); // Reset timeout
          
          if (data && data.type === 'HEARTBEAT') {
              // Répondre pong si nécessaire, ou juste ack
              return; 
          }
          
          this.handleProtocolData(data, conn.peer);
      });

      conn.on('open', () => {
          console.log(`[Connectivity] Connection OPEN with ${conn.peer}`);
          
          if (this.role === OperatorRole.OPR && conn.peer === this.hostId) {
              this.notify({ type: 'HOST_CONNECTED', hostId: conn.peer });
              // Client envoie son profil complet
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
          conn.close(); // Force clean close
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
             this.handleReconnect();
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
      
      // Optimisation: Pas de broadcast systématique si peu de changement? 
      // Ici on broadcast toujours pour le temps réel
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
              if (now - last > HEARTBEAT_TIMEOUT_MS) {
                  console.warn(`[Connectivity] Peer Timeout: ${peerId}`);
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
