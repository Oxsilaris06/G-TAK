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

const RECONNECT_INTERVAL = 3000;
const SYNC_INTERVAL = 2000;
const HANDSHAKE_RETRY = 1000;

class ConnectivityService {
  private peer: Peer | null = null;
  private connections: Record<string, DataConnection> = {};
  private listeners: Listener[] = [];
  
  private user: UserData | null = null;
  private hostId: string | null = null;
  private role: OperatorRole = OperatorRole.OPR;
  private peersMap: Record<string, UserData> = {};
  
  private syncInterval: any = null;
  private retryTimeout: any = null;
  private handshakeInterval: any = null;
  
  private isDestroyed = false;

  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private notify(event: ConnectivityEvent) {
    this.listeners.forEach(l => l(event));
  }

  public async init(user: UserData, role: OperatorRole, targetHostId?: string) {
    this.cleanup(false);
    this.isDestroyed = false;
    
    this.user = { ...user, role };
    this.role = role;
    this.hostId = targetHostId || null;

    const myId = role === OperatorRole.HOST ? this.generateShortId() : undefined; 
    
    console.log(`[NET] Init. Role: ${role}, TargetHost: ${targetHostId}`);
    this.createPeer(myId);
  }

  private createPeer(id?: string) {
    try {
        console.log("[NET] Creating Peer with config:", JSON.stringify(CONFIG.PEER_CONFIG));
        const peer = new Peer(id, CONFIG.PEER_CONFIG as any);
        this.peer = peer;

        peer.on('open', (peerId) => {
            console.log(`[NET] Peer OPEN: ${peerId}`);
            if (this.user) this.user.id = peerId;
            this.notify({ type: 'PEER_OPEN', id: peerId });

            if (this.role === OperatorRole.HOST) {
                this.hostId = peerId;
                this.peersMap[peerId] = this.user!;
                this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
                this.notify({ type: 'TOAST', msg: `Hôte Actif: ${peerId}`, level: 'success' });
                this.startHostSync();
            } else if (this.hostId) {
                // Petit délai pour laisser le temps au réseau de se stabiliser
                setTimeout(() => this.connectToHost(this.hostId!), 500);
            }
        });

        peer.on('connection', (conn) => {
            console.log(`[NET] Incoming connection from ${conn.peer}`);
            this.setupConnection(conn);
        });

        peer.on('error', (err: any) => {
            console.error(`[NET] Peer Error: ${err.type}`, err);
            
            // Gestion spécifique des erreurs courantes
            if (err.type === 'unavailable-id') {
                this.notify({ type: 'TOAST', msg: 'ID Hôte indisponible (déjà pris ?)', level: 'warning' });
                setTimeout(() => this.createPeer(undefined), 1000);
            } else if (err.type === 'peer-unavailable') {
                if (!this.isDestroyed && this.role === OperatorRole.OPR) {
                   // Ne pas spammer l'utilisateur, mais logger
                   console.log(`[NET] Host ${this.hostId} not found yet... retrying.`);
                   this.scheduleReconnect();
                }
            } else if (err.type === 'network' || err.type === 'disconnected' || err.type === 'server-error' || err.type === 'socket-error') {
                // Erreurs critiques de connexion au serveur de signalisation
                this.scheduleReconnect();
            } else if (err.type === 'browser-incompatible') {
                this.notify({ type: 'TOAST', msg: 'Erreur compatibilité WebRTC', level: 'error' });
            }
        });

        peer.on('disconnected', () => {
            console.log('[NET] Disconnected from signaling server');
            if (!this.isDestroyed && this.peer && !this.peer.destroyed) {
                this.peer.reconnect();
            }
        });

    } catch (e) {
        console.error('[NET] Crash creation', e);
        this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
      if (this.retryTimeout) clearTimeout(this.retryTimeout);
      if (this.isDestroyed) return;

      this.retryTimeout = setTimeout(() => {
          console.log('[NET] Reconnecting sequence...');
          if (this.peer) {
              this.peer.destroy();
              this.peer = null;
          }
          this.createPeer(this.role === OperatorRole.HOST && this.user?.id ? this.user.id : undefined);
      }, RECONNECT_INTERVAL);
  }

  public connectToHost(targetId: string) {
      if (!this.peer || this.peer.destroyed) return;
      
      console.log(`[NET] Connecting to Host ${targetId}...`);
      
      if (this.connections[targetId]) {
          this.connections[targetId].close();
          delete this.connections[targetId];
      }

      // CRITIQUE : serialization: 'json' OBLIGATOIRE sur React Native
      // Par défaut PeerJS utilise BinaryPack qui ne passe pas bien le Bridge RN
      const conn = this.peer.connect(targetId, { 
          reliable: true, 
          serialization: 'json',
          metadata: {
              role: 'OPR',
              version: '3.3.0'
          }
      });
      
      this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection) {
      conn.on('open', () => {
          console.log(`[NET] Tunnel OPEN with ${conn.peer}`);
          this.connections[conn.peer] = conn;

          if (this.role === OperatorRole.HOST) {
              this.sendSync(conn);
          } else {
              this.notify({ type: 'HOST_CONNECTED', hostId: conn.peer });
              this.startClientHandshake(conn);
          }
      });

      conn.on('data', (data) => this.handleData(data, conn.peer));
      
      conn.on('close', () => {
          console.log(`[NET] Tunnel CLOSE with ${conn.peer}`);
          delete this.connections[conn.peer];
          delete this.peersMap[conn.peer];
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
          
          if (this.role === OperatorRole.OPR && conn.peer === this.hostId) {
              this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
              this.scheduleReconnect();
          }
      });
      
      conn.on('error', (err) => {
          console.warn(`[NET] Conn Error with ${conn.peer}:`, err);
          // Ne pas fermer immédiatement, laisser PeerJS gérer le retry si possible
      });
  }

  private startClientHandshake(conn: DataConnection) {
      if (this.handshakeInterval) clearInterval(this.handshakeInterval);
      
      // Envoie immédiat
      console.log('[NET] Sending initial HELLO...');
      conn.send({ type: 'HELLO', user: this.user });

      // Retry loop
      this.handshakeInterval = setInterval(() => {
          if (conn.open) {
              // console.log('[NET] Retry HELLO...');
              conn.send({ type: 'HELLO', user: this.user });
          } else {
              clearInterval(this.handshakeInterval);
          }
      }, HANDSHAKE_RETRY);
  }

  private startHostSync() {
      if (this.syncInterval) clearInterval(this.syncInterval);
      
      this.syncInterval = setInterval(() => {
          const list = Object.values(this.peersMap);
          if (this.user) list.push(this.user);
          
          const payload = { type: 'SYNC', list };
          
          Object.values(this.connections).forEach(conn => {
              if (conn.open) conn.send(payload);
          });
      }, SYNC_INTERVAL);
  }

  private sendSync(conn: DataConnection) {
      const list = Object.values(this.peersMap);
      if (this.user) list.push(this.user);
      conn.send({ type: 'SYNC', list });
  }

  private handleData(data: any, fromId: string) {
      if (this.role === OperatorRole.OPR && data.type === 'SYNC') {
          if (this.handshakeInterval) {
              console.log('[NET] Handshake success, stopping retry.');
              clearInterval(this.handshakeInterval);
              this.handshakeInterval = null;
              this.notify({ type: 'TOAST', msg: 'Synchronisé', level: 'success' });
          }
      }

      this.notify({ type: 'DATA_RECEIVED', data, from: fromId });

      if (data.type === 'HELLO' || data.type === 'UPDATE' || data.type === 'UPDATE_USER') {
          if (data.user) {
              this.peersMap[data.user.id] = data.user;
              this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
              if (this.role === OperatorRole.HOST && data.type === 'HELLO') {
                  const conn = this.connections[fromId];
                  if (conn) this.sendSync(conn);
              }
          }
      } else if (data.type === 'SYNC' && Array.isArray(data.list)) {
          data.list.forEach((u: UserData) => {
              if (u.id !== this.user?.id) this.peersMap[u.id] = u;
          });
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
      } else if (data.type === 'KICK' && fromId === this.hostId) {
          this.cleanup();
          this.notify({ type: 'DISCONNECTED', reason: 'KICKED' });
      }
  }

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
      }
  }

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

  public kickUser(targetId: string) {
      if (this.role !== OperatorRole.HOST) return;
      this.sendTo(targetId, { type: 'KICK' });
      setTimeout(() => {
          const conn = this.connections[targetId];
          if(conn) conn.close();
      }, 200);
  }

  public cleanup(full = true) {
      this.isDestroyed = full;
      if (this.syncInterval) clearInterval(this.syncInterval);
      if (this.handshakeInterval) clearInterval(this.handshakeInterval);
      if (this.retryTimeout) clearTimeout(this.retryTimeout);
      
      Object.values(this.connections).forEach(c => c.close());
      this.connections = {};
      this.peersMap = {};
      
      if (this.peer) {
          this.peer.destroy();
          this.peer = null;
      }
  }

  private generateShortId(): string {
      return Math.random().toString(36).substring(2, 10).toUpperCase();
  }
}

export const connectivityService = new ConnectivityService();
