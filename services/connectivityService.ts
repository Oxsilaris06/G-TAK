import Peer, { DataConnection } from 'peerjs';
import { CONFIG } from '../constants';
import { UserData, OperatorRole, OperatorStatus } from '../types';

export type ConnectivityEvent = 
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEERS_UPDATED'; peers: Record<string, UserData> }
  | { type: 'HOST_CONNECTED'; hostId: string }
  | { type: 'DISCONNECTED'; reason: 'KICKED' | 'NO_HOST' | 'NETWORK_ERROR' | 'MANUAL' }
  | { type: 'RECONNECTING'; attempt: number }
  | { type: 'TOAST'; msg: string; level: 'info' | 'error' | 'success' }
  | { type: 'DATA_RECEIVED'; data: any; from: string }
  | { type: 'MIGRATION_START' }
  | { type: 'NEW_HOST_PROMOTED'; hostId: string };

type Listener = (event: ConnectivityEvent) => void;

// Configuration Résilience (Délais ajustés pour mobile)
const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 20;
const HEARTBEAT_MS = 2000;
const TIMEOUT_MS = 8000; 

// États internes
enum ConnectionState {
    DISCONNECTED,
    INITIALIZING,
    CONNECTED,
    RECOVERING
}

class ConnectivityService {
  private peer: Peer | null = null;
  private connections: Record<string, DataConnection> = {};
  private listeners: Listener[] = [];
  
  // État Applicatif
  private user: UserData | null = null;
  private hostId: string | null = null;
  private targetHostId: string | null = null;
  private role: OperatorRole = OperatorRole.OPR;
  private peersMap: Record<string, UserData> = {};
  private bannedPeers: Set<string> = new Set();

  // État Technique
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private retryCount = 0;
  private heartbeatTimer: any = null;
  private lastHeartbeat: Record<string, number> = {};
  
  // File d'attente pour garantir l'envoi post-connexion
  private msgQueue: { targetId?: string, data: any }[] = [];

  // --- ABONNEMENTS ---
  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private notify(event: ConnectivityEvent) {
    this.listeners.forEach(l => l(event));
  }

  // --- INITIALISATION (HARD RESET) ---
  public async init(user: UserData, role: OperatorRole, targetHostId?: string, forceId?: string) {
    // Évite les doubles inits
    if (this.state === ConnectionState.INITIALIZING) return;

    this.cleanup(false); 
    
    this.state = ConnectionState.INITIALIZING;
    this.user = { ...user, role };
    this.role = role;
    this.targetHostId = targetHostId || null;

    const myId = forceId || (role === OperatorRole.HOST ? this.generateShortId() : undefined);
    console.log(`[Connectivity] Hard Init. Role: ${role}, ID: ${myId || 'AUTO'}`);

    this.createPeer(myId);
  }

  private createPeer(id?: string) {
    try {
        const peer = new Peer(id, CONFIG.PEER_CONFIG as any);
        this.peer = peer;

        // Timeout de sécurité : si pas OPEN en 10s, on tue et on réessaie
        const openTimeout = setTimeout(() => {
            if (this.state === ConnectionState.INITIALIZING) {
                console.warn('[Connectivity] Peer Open Timeout. Retrying...');
                this.handleConnectionFailure();
            }
        }, 10000);

        peer.on('open', (peerId) => {
            clearTimeout(openTimeout);
            this.onPeerOpen(peerId);
        });

        peer.on('connection', (conn) => this.onIncomingConnection(conn));
        
        peer.on('error', (err: any) => this.onPeerError(err));
        
        peer.on('disconnected', () => {
            // Pas de reconnect() ici, c'est la source des bugs fantômes. 
            // On détecte la déconnexion et on lance la procédure de Hard Reset.
            console.log('[Connectivity] Peer disconnected event.');
            this.handleConnectionFailure();
        });

        peer.on('close', () => {
            this.state = ConnectionState.DISCONNECTED;
        });

    } catch (e) {
        console.error('Peer creation crash', e);
        this.handleConnectionFailure();
    }
  }

  private onPeerOpen(id: string) {
      console.log(`[Connectivity] Peer READY: ${id}`);
      this.state = ConnectionState.CONNECTED;
      this.retryCount = 0;
      
      if (this.user) this.user.id = id;
      this.notify({ type: 'PEER_OPEN', id });

      if (this.role === OperatorRole.HOST) {
          this.hostId = id;
          this.peersMap[id] = this.user!;
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
          this.notify({ type: 'TOAST', msg: 'Session Active', level: 'success' });
          this.startHeartbeat();
      } else if (this.targetHostId) {
          this.connectToHost(this.targetHostId);
      }
      
      this.flushQueue();
  }

  // --- GESTION DES ERREURS ---
  private onPeerError(err: any) {
      console.error(`[Connectivity] Peer Error: ${err.type}`, err);
      
      if (err.type === 'unavailable-id') {
          this.cleanup();
          setTimeout(() => this.init(this.user!, this.role, this.targetHostId!, undefined), 1000);
      } else if (err.type === 'peer-unavailable') {
          this.notify({ type: 'TOAST', msg: 'Hôte introuvable', level: 'error' });
          this.handleConnectionFailure(); 
      } else {
          this.handleConnectionFailure();
      }
  }

  private handleConnectionFailure() {
      if (this.state === ConnectionState.RECOVERING) return;
      
      if (this.retryCount >= MAX_RETRIES) {
          this.notify({ type: 'DISCONNECTED', reason: 'NETWORK_ERROR' });
          this.cleanup();
          return;
      }

      this.state = ConnectionState.RECOVERING;
      this.retryCount++;
      const delay = Math.min(RETRY_DELAY_MS * this.retryCount, 10000);
      
      this.notify({ type: 'RECONNECTING', attempt: this.retryCount });
      console.log(`[Connectivity] Recovery sequence ${this.retryCount}/${MAX_RETRIES} in ${delay}ms`);

      if (this.peer) {
          this.peer.destroy();
          this.peer = null;
      }

      setTimeout(() => {
          const currentId = this.user?.id; 
          this.createPeer(currentId); 
      }, delay);
  }

  // --- CONNEXION P2P ---
  public connectToHost(targetId: string) {
      if (!this.peer || this.state !== ConnectionState.CONNECTED) {
          console.log('[Connectivity] Not ready to connect, queueing...');
          return;
      }

      console.log(`[Connectivity] Connecting to Host ${targetId}...`);
      
      if (this.connections[targetId]) {
          this.connections[targetId].close();
          delete this.connections[targetId];
      }

      const conn = this.peer.connect(targetId, {
          reliable: true,
          serialization: 'json',
          metadata: { version: '3.3.0' }
      });

      this.setupConnection(conn);
  }

  private onIncomingConnection(conn: DataConnection) {
      if (this.bannedPeers.has(conn.peer)) {
          conn.close();
          return;
      }
      this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection) {
      conn.on('open', () => {
          console.log(`[Connectivity] Connection OPEN with ${conn.peer}`);
          this.connections[conn.peer] = conn;
          this.lastHeartbeat[conn.peer] = Date.now();

          // DELAI DE SECURITE (WARM-UP) POUR ANDROID
          // Vital pour s'assurer que le buffer UDP est prêt avant d'envoyer le SYNC lourd
          setTimeout(() => {
              if (this.role === OperatorRole.HOST) {
                  // Hôte envoie la liste des pairs
                  conn.send({ type: 'SYNC', list: Object.values(this.peersMap) });
              } else if (conn.peer === this.targetHostId) {
                  // Client envoie son profil
                  this.hostId = conn.peer;
                  this.notify({ type: 'HOST_CONNECTED', hostId: this.hostId });
                  conn.send({ type: 'FULL', user: this.user });
                  this.startHeartbeat();
              }
              this.flushQueue();
          }, 500); 
      });

      conn.on('data', (data) => this.handleData(data, conn.peer));
      
      conn.on('close', () => {
          console.log(`[Connectivity] Connection CLOSE with ${conn.peer}`);
          this.handlePeerLoss(conn.peer);
      });
      
      conn.on('error', (e) => {
          console.warn(`[Connectivity] Connection ERROR with ${conn.peer}`, e);
          conn.close();
      });
  }

  // --- TRAITEMENT DES DONNÉES ---
  private handleData(data: any, fromId: string) {
      this.lastHeartbeat[fromId] = Date.now();

      if (data.type === 'HEARTBEAT') return;

      // Mécanisme d'acquittement implicite pour le SYNC
      if (data.type === 'FULL' && this.role === OperatorRole.HOST) {
          // Si on reçoit FULL, c'est que le client vient d'arriver ou de reconnecter
          // On lui renvoie TOUT pour être sûr qu'il est à jour
          this.sendTo(fromId, { type: 'SYNC', list: Object.values(this.peersMap) });
      }

      this.notify({ type: 'DATA_RECEIVED', data, from: fromId });

      if (data.type === 'FULL' || data.type === 'UPDATE' || data.type === 'UPDATE_USER') {
          if (data.user) {
              this.peersMap[data.user.id] = data.user;
              this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
          }
      } else if (data.type === 'SYNC' && Array.isArray(data.list)) {
          data.list.forEach((u: UserData) => this.peersMap[u.id] = u);
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
      } else if (data.type === 'KICK' && fromId === this.hostId) {
          this.cleanup();
          this.notify({ type: 'DISCONNECTED', reason: 'KICKED' });
      }
  }

  private handlePeerLoss(peerId: string) {
      delete this.connections[peerId];
      delete this.peersMap[peerId];
      delete this.lastHeartbeat[peerId];
      
      this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });

      if (this.role === OperatorRole.OPR && peerId === this.hostId) {
          this.notify({ type: 'TOAST', msg: 'Lien Hôte perdu', level: 'error' });
          if (this.targetHostId) {
              setTimeout(() => this.connectToHost(this.targetHostId!), 1000);
          }
      }
  }

  // --- HEARTBEAT SYSTEM ---
  private startHeartbeat() {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      
      this.heartbeatTimer = setInterval(() => {
          const now = Date.now();
          
          Object.values(this.connections).forEach(conn => {
              if (conn.open) conn.send({ type: 'HEARTBEAT' });
          });

          Object.keys(this.connections).forEach(peerId => {
              const last = this.lastHeartbeat[peerId] || now;
              if (now - last > TIMEOUT_MS) {
                  console.warn(`[Connectivity] Peer Timeout: ${peerId}`);
                  const conn = this.connections[peerId];
                  if(conn) conn.close();
                  this.handlePeerLoss(peerId);
              }
          });
      }, HEARTBEAT_MS);
  }

  // --- MESSAGERIE PUBLIQUE ---
  public broadcast(data: any) {
      if (!this.user) return;
      const payload = { ...data, from: this.user.id };
      
      Object.values(this.connections).forEach(conn => {
          if (conn.open) conn.send(payload);
      });
  }

  public sendTo(targetId: string, data: any) {
      if (!this.user) return;
      const conn = this.connections[targetId];
      
      if (conn && conn.open) {
          conn.send({ ...data, from: this.user.id });
      } else {
          console.log(`[Connectivity] Queueing message for ${targetId}`);
          this.msgQueue.push({ targetId, data: { ...data, from: this.user.id } });
      }
  }

  private flushQueue() {
      if (this.msgQueue.length === 0) return;
      
      const remaining: typeof this.msgQueue = [];
      
      this.msgQueue.forEach(item => {
          const conn = item.targetId ? this.connections[item.targetId] : null;
          if (conn && conn.open) {
              conn.send(item.data);
          } else {
              remaining.push(item);
          }
      });
      
      this.msgQueue = remaining;
  }

  // --- HELPERS ---
  public updateUser(partial: Partial<UserData>) {
      if (!this.user) return;
      this.user = { ...this.user, ...partial };
      this.broadcast({ type: 'UPDATE', user: this.user });
      
      if (this.user.id) {
          this.peersMap[this.user.id] = this.user;
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
      }
  }
  
  public updateUserStatus(status: OperatorStatus) {
      this.updateUser({ status });
  }
  
  public updateUserPosition(lat: number, lng: number, head: number) {
      if (!this.user) return;
      this.user = { ...this.user, lat, lng, head };
      this.broadcast({ type: 'UPDATE_USER', user: this.user });
  }

  public kickUser(targetId: string, ban = false) {
      if (this.role !== OperatorRole.HOST) return;
      this.sendTo(targetId, { type: 'KICK' });
      if (ban) this.bannedPeers.add(targetId);
      
      setTimeout(() => {
          const conn = this.connections[targetId];
          if(conn) conn.close();
      }, 500);
  }

  public cleanup(full = true) {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      
      Object.values(this.connections).forEach(c => c.close());
      this.connections = {};
      this.peersMap = {};
      this.msgQueue = [];
      
      if (this.peer) {
          this.peer.destroy();
          this.peer = null;
      }
      
      this.state = ConnectionState.DISCONNECTED;
      if (full) this.bannedPeers.clear();
  }

  private generateShortId(): string {
      return Math.random().toString(36).substring(2, 10).toUpperCase();
  }
}

export const connectivityService = new ConnectivityService();
