import Peer, { DataConnection } from 'peerjs';
import { CONFIG } from '../constants';
import { UserData, OperatorRole, OperatorStatus } from '../types';

// Types d'événements exposés
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

// Configuration interne de résilience
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 15;
const HEARTBEAT_INTERVAL_MS = 3000;
const HEARTBEAT_TIMEOUT_MS = 10000;

class ConnectivityService {
  private peer: Peer | null = null;
  private connections: Record<string, DataConnection> = {}; 
  private peersMap: Record<string, UserData> = {}; 
  private listeners: Listener[] = [];

  private user: UserData | null = null;
  private hostId: string | null = null;
  private role: OperatorRole = OperatorRole.OPR;
  private targetHostId: string | null = null; 

  // État Résilience
  private isMigrating: boolean = false;
  private reconnectAttempts = 0;
  private isReconnecting = false;
  private heartbeatTimer: any = null;
  private lastHeartbeat: Record<string, number> = {}; 
  private bannedPeers: Set<string> = new Set();

  // --- ABONNEMENTS ---
  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private notify(event: ConnectivityEvent) {
    this.listeners.forEach(l => l(event));
  }

  // --- INITIALISATION ---
  public async init(user: UserData, role: OperatorRole, targetHostId?: string, forceId?: string) {
    if (this.peer && !this.peer.destroyed && !this.peer.disconnected) {
        if (this.user?.role === role && (!targetHostId || this.hostId === targetHostId)) {
            return;
        }
    }

    this.cleanup(false); 
    this.user = { ...user, role };
    this.role = role;
    this.targetHostId = targetHostId || null;

    this.connectPeer(forceId);
  }

  private connectPeer(forceId?: string) {
    const myId = forceId || (this.role === OperatorRole.HOST ? this.generateShortId() : undefined);
    console.log(`[Connectivity] Init Peer. Role: ${this.role}, ID: ${myId || 'AUTO'}`);

    try {
      this.peer = new Peer(myId, CONFIG.PEER_CONFIG as any);
      this.setupPeerListeners();
    } catch (e) {
      console.error('Init Failed', e);
      this.notify({ type: 'TOAST', msg: 'Echec initialisation réseau', level: 'error' });
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
          this.notify({ type: 'TOAST', msg: `Session Créée: ${id}`, level: 'success' }); // Message nettoyé
          this.startHeartbeatLoop();
        } else if (this.targetHostId) {
          this.connectToHost(this.targetHostId);
        }
    });

    this.peer.on('connection', (conn) => {
        if (this.bannedPeers.has(conn.peer)) {
            console.warn(`[Connectivity] Blocked banned peer: ${conn.peer}`);
            conn.close();
            return;
        }
        this.handleIncomingConnection(conn);
    });
    
    this.peer.on('error', (err: any) => {
        console.error(`[Connectivity] Peer Error: ${err.type}`, err);
        
        if (err.type === 'unavailable-id') {
           this.notify({ type: 'TOAST', msg: 'ID indisponible, nouvel essai...', level: 'info' });
           setTimeout(() => this.connectPeer(), 1000);
        } else if (err.type === 'peer-unavailable') {
             this.notify({ type: 'TOAST', msg: 'Hôte introuvable', level: 'error' });
             if (!this.isMigrating) this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
        } else if (err.type === 'network' || err.type === 'disconnected' || err.type === 'webrtc') {
            this.handleReconnect();
        }
    });

    this.peer.on('disconnected', () => {
        console.warn('[Connectivity] Peer Disconnected (Signal)');
        if (!this.peer?.destroyed) {
            this.handleReconnect();
        }
    });
  }

  // --- RECONNEXION INTELLIGENTE ---
  private handleReconnect() {
      if (this.isReconnecting) return;
      if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
          this.notify({ type: 'DISCONNECTED', reason: 'NETWORK_ERROR' });
          return;
      }

      this.isReconnecting = true;
      this.reconnectAttempts++;
      const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(1.5, this.reconnectAttempts), 10000);

      this.notify({ type: 'RECONNECTING', attempt: this.reconnectAttempts });
      console.log(`[Connectivity] Reconnecting in ${delay}ms...`);

      setTimeout(() => {
          this.isReconnecting = false;
          if (this.peer && !this.peer.destroyed) {
              this.peer.reconnect();
          } else {
              // Recréation complète si nécessaire
              this.connectPeer();
          }
      }, delay);
  }

  // --- CONNEXION ---
  public connectToHost(targetId: string) {
    if (!this.peer || !this.user) return;
    if (targetId === this.peer.id) return;

    this.hostId = targetId;
    this.targetHostId = targetId;
    
    if (this.connections[targetId]) {
      this.connections[targetId].close();
    }

    const conn = this.peer.connect(targetId, { reliable: true, serialization: 'json' });
    this.setupDataConnection(conn);
  }

  private handleIncomingConnection(conn: DataConnection) {
    conn.on('open', () => {
      this.connections[conn.peer] = conn;
      if (this.role === OperatorRole.HOST) {
        const peerList = Object.values(this.peersMap);
        conn.send({ type: 'SYNC', list: peerList });
      }
    });
    this.setupDataConnection(conn);
  }

  private setupDataConnection(conn: DataConnection) {
    this.connections[conn.peer] = conn;
    this.lastHeartbeat[conn.peer] = Date.now();

    conn.on('data', (data: any) => {
      this.lastHeartbeat[conn.peer] = Date.now();
      if (data && (data.type === 'HEARTBEAT' || data.type === 'PING_ALIVE')) return;
      this.handleProtocolData(data, conn.peer);
    });

    conn.on('open', () => {
        if (conn.peer === this.hostId) {
             this.notify({ type: 'HOST_CONNECTED', hostId: conn.peer });
             conn.send({ type: 'FULL', user: this.user });
             this.startHeartbeatLoop();
        }
    });

    conn.on('close', () => {
      delete this.connections[conn.peer];
      delete this.peersMap[conn.peer];
      this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
      
      if (conn.peer === this.hostId && !this.isMigrating && this.role === OperatorRole.OPR) {
        this.handleHostLoss();
      }
    });
    
    conn.on('error', (err) => console.warn(`Conn error with ${conn.peer}`, err));
  }

  // --- TRAITEMENT DONNÉES ---
  private handleProtocolData(data: any, fromId: string) {
    if (this.bannedPeers.has(fromId)) return;
    
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

      case 'HOST_MIGRATE_INSTRUCTION':
        this.notify({ type: 'TOAST', msg: 'Migration forcée reçue', level: 'info' });
        this.promoteSelfToHost();
        break;
        
      case 'KICK':
        if (fromId === this.hostId) {
            this.cleanup();
            this.notify({ type: 'DISCONNECTED', reason: 'KICKED' });
        }
        break;
    }
  }

  // --- MIGRATION & RÉSILIENCE ---
  private handleHostLoss() {
    if (this.isMigrating) return;
    this.isMigrating = true;
    this.notify({ type: 'MIGRATION_START' });
    this.notify({ type: 'TOAST', msg: 'Hôte perdu - Élection...', level: 'error' });

    setTimeout(() => {
       const candidates = Object.values(this.peersMap).filter(p => p.id !== this.hostId);
       if (this.user) candidates.push(this.user);
       candidates.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
       
       const newHost = candidates[0];
       
       if (newHost && this.user && newHost.id === this.user.id) {
           this.promoteSelfToHost();
       } else if (newHost) {
           this.notify({ type: 'TOAST', msg: `Nouvel Hôte: ${newHost.callsign}`, level: 'info' });
           setTimeout(() => {
               this.connectToHost(newHost.id);
               this.isMigrating = false;
           }, 3000);
       } else {
           this.cleanup();
           this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
       }
    }, 2000 + Math.random() * 2000);
  }

  private promoteSelfToHost() {
    const currentId = this.user?.id;
    const currentUser = this.user!;
    const oldPeers = { ...this.peersMap };
    
    this.cleanup(false); 
    
    setTimeout(() => {
        this.init(currentUser, OperatorRole.HOST, undefined, currentId);
        this.peersMap = oldPeers; 
        if (currentId) this.peersMap[currentId] = currentUser;
        
        this.isMigrating = false;
        this.notify({ type: 'NEW_HOST_PROMOTED', hostId: currentId || '' });
        this.notify({ type: 'TOAST', msg: 'Vous êtes le nouvel Hôte', level: 'success' });
    }, 1000);
  }

  // --- ACTIONS ---
  public broadcast(data: any) {
    if (!this.user) return;
    const payload = { ...data, from: this.user.id };
    Object.values(this.connections).forEach(conn => {
      if (conn.open) {
          try { conn.send(payload); } catch(e) {}
      }
    });
  }
  
  public sendTo(targetId: string, data: any) {
      if (!this.user) return;
      const conn = this.connections[targetId];
      if (conn && conn.open) {
          conn.send({ ...data, from: this.user.id });
      }
  }

  public kickUser(targetId: string, ban = false) {
      if (this.role !== OperatorRole.HOST) return;
      this.sendTo(targetId, { type: 'KICK' });
      if (ban) this.bannedPeers.add(targetId);
      
      setTimeout(() => {
          const conn = this.connections[targetId];
          if (conn) { conn.close(); }
          delete this.connections[targetId];
          delete this.peersMap[targetId];
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
      }, 500);
  }

  public updateUserStatus(status: OperatorStatus) {
    if (!this.user) return;
    this.user.status = status;
    this.updateUserAndNotify();
  }
  
  public updateUserPosition(lat: number, lng: number, head: number) {
     if(!this.user) return;
     this.user.lat = lat;
     this.user.lng = lng;
     this.user.head = head;
     this.updateUserAndNotify(false);
  }

  public updateUser(partialUser: Partial<UserData>) {
      if (!this.user) return;
      this.user = { ...this.user, ...partialUser };
      this.updateUserAndNotify();
  }

  private updateUserAndNotify(notifyLocal = true) {
      if (!this.user) return;
      if (this.user.id) this.peersMap[this.user.id] = this.user;
      this.broadcast({ type: 'UPDATE', user: this.user });
      if (notifyLocal) this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
  }

  // --- HEARTBEAT ---
  private startHeartbeatLoop() {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => {
          const now = Date.now();
          Object.values(this.connections).forEach(conn => {
              if (conn.open) conn.send({ type: 'HEARTBEAT' });
          });
          Object.keys(this.connections).forEach(peerId => {
              const last = this.lastHeartbeat[peerId] || now;
              if (now - last > HEARTBEAT_TIMEOUT_MS) {
                  console.warn(`[Connectivity] Timeout: ${peerId}`);
                  const conn = this.connections[peerId];
                  if (conn) conn.close();
                  delete this.connections[peerId];
                  delete this.peersMap[peerId];
                  this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
                  
                  if (peerId === this.hostId && !this.isMigrating && this.role === OperatorRole.OPR) {
                      this.handleHostLoss();
                  }
              }
          });
      }, HEARTBEAT_INTERVAL_MS);
  }

  public cleanup(full = true) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.peer?.destroy();
    this.peer = null;
    this.connections = {};
    this.peersMap = {};
    this.hostId = null;
    this.isMigrating = false;
    if (full) this.bannedPeers.clear();
  }

  private generateShortId(): string {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }
}

export const connectivityService = new ConnectivityService();
