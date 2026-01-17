import Peer, { DataConnection } from 'peerjs';
import { CONFIG } from '../constants';
import { UserData, OperatorRole, OperatorStatus } from '../types';
import { AppStateStatus } from 'react-native';

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
  private isPaused = false; 
  private isConnecting = false;

  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private notify(event: ConnectivityEvent) {
    this.listeners.forEach(l => l(event));
  }

  public handleAppStateChange(status: AppStateStatus) {
      if (status === 'background') {
          this.isPaused = true;
          if (this.retryTimeout) clearTimeout(this.retryTimeout);
          if (this.handshakeInterval) clearInterval(this.handshakeInterval);
      } else if (status === 'active') {
          this.isPaused = false;
          if (!this.peer || this.peer.disconnected || this.peer.destroyed) {
              console.log("[NET] Resume from background: Reconnecting...");
              this.scheduleReconnect(true);
          } else if (this.role === OperatorRole.OPR && this.hostId && !this.connections[this.hostId]) {
              this.connectToHost(this.hostId);
          }
      }
  }

  public async init(user: UserData, role: OperatorRole, targetHostId?: string) {
    this.cleanup(false);
    this.isDestroyed = false;
    this.isPaused = false;
    
    this.user = { ...user, role };
    this.role = role;
    this.hostId = targetHostId || null;

    const myId = role === OperatorRole.HOST ? this.generateShortId() : undefined; 
    
    console.log(`[NET] Init. Role: ${role}, TargetHost: ${targetHostId}`);
    this.createPeer(myId);
  }

  private createPeer(id?: string) {
    if (this.isPaused || this.isConnecting) return;
    this.isConnecting = true;

    try {
        console.log("[NET] Creating Peer...");
        const peer = new Peer(id, CONFIG.PEER_CONFIG as any);
        this.peer = peer;

        peer.on('open', (peerId) => {
            this.isConnecting = false;
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
                setTimeout(() => this.connectToHost(this.hostId!), 500);
            }
        });

        peer.on('connection', (conn) => {
            console.log(`[NET] Incoming connection from ${conn.peer}`);
            this.setupConnection(conn);
        });

        peer.on('error', (err: any) => {
            this.isConnecting = false;
            console.error(`[NET] Peer Error: ${err.type}`, err);
            
            if (this.isPaused) return;

            if (err.type === 'unavailable-id') {
                this.notify({ type: 'TOAST', msg: 'ID Hôte indisponible (déjà pris ?)', level: 'warning' });
                setTimeout(() => this.createPeer(undefined), 1000);
            } else if (err.type === 'peer-unavailable') {
                if (!this.isDestroyed && this.role === OperatorRole.OPR) {
                   console.log(`[NET] Host ${this.hostId} not found yet... retrying.`);
                   this.scheduleReconnect();
                }
            } else if (err.type === 'network' || err.type === 'disconnected' || err.type === 'server-error' || err.type === 'socket-error') {
                this.scheduleReconnect();
            } else if (err.type === 'browser-incompatible') {
                this.notify({ type: 'TOAST', msg: 'Erreur compatibilité WebRTC', level: 'error' });
            }
        });

        peer.on('disconnected', () => {
            console.log('[NET] Disconnected from signaling server');
            if (!this.isDestroyed && !this.isPaused && this.peer && !this.peer.destroyed) {
                this.peer.reconnect();
            }
        });

    } catch (e) {
        this.isConnecting = false;
        console.error('[NET] Crash creation', e);
        this.scheduleReconnect();
    }
  }

  private scheduleReconnect(immediate = false) {
      if (this.retryTimeout) clearTimeout(this.retryTimeout);
      if (this.isDestroyed || this.isPaused) return;

      const delay = immediate ? 100 : RECONNECT_INTERVAL;

      this.retryTimeout = setTimeout(() => {
          console.log('[NET] Reconnecting sequence...');
          if (this.peer) {
              this.peer.destroy();
              this.peer = null;
          }
          this.createPeer(this.role === OperatorRole.HOST && this.user?.id ? this.user.id : undefined);
      }, delay);
  }

  public connectToHost(targetId: string) {
      if (!this.peer || this.peer.destroyed || this.isPaused) return;
      
      console.log(`[NET] Connecting to Host ${targetId}...`);
      
      if (this.connections[targetId]) {
          this.connections[targetId].close();
          delete this.connections[targetId];
      }

      const conn = this.peer.connect(targetId, { 
          reliable: true, 
          serialization: 'json',
          metadata: { role: 'OPR', version: '3.3.0' }
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
          this.removePeer(conn.peer); // Nettoyage centralisé
          
          if (!this.isPaused && this.role === OperatorRole.OPR && conn.peer === this.hostId) {
              this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
              this.scheduleReconnect();
          }
      });
      
      conn.on('error', (err) => {
          console.warn(`[NET] Conn Error with ${conn.peer}:`, err);
      });
  }

  // Helper pour suppression propre
  private removePeer(peerId: string) {
      if (this.connections[peerId]) {
          // On ne close pas ici pour éviter une boucle, car c'est souvent appelé par 'close' ou 'CLIENT_LEAVING'
          delete this.connections[peerId];
      }
      if (this.peersMap[peerId]) {
          delete this.peersMap[peerId];
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
      }
  }

  private startClientHandshake(conn: DataConnection) {
      if (this.handshakeInterval) clearInterval(this.handshakeInterval);
      
      console.log('[NET] Sending initial HELLO...');
      conn.send({ type: 'HELLO', user: this.user });

      this.handshakeInterval = setInterval(() => {
          if (this.isPaused) return; 
          if (conn.open) {
              conn.send({ type: 'HELLO', user: this.user });
          } else {
              clearInterval(this.handshakeInterval);
          }
      }, HANDSHAKE_RETRY);
  }

  private startHostSync() {
      if (this.syncInterval) clearInterval(this.syncInterval);
      
      this.syncInterval = setInterval(() => {
          if (this.isPaused) return;

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

      // --- GESTION DU DÉPART EXPLICITE ---
      if (data.type === 'CLIENT_LEAVING') {
          const callsign = data.callsign || fromId.substring(0,4);
          this.notify({ type: 'TOAST', msg: `${callsign} a quitté.`, level: 'info' });
          
          // Suppression immédiate de la carte et des listes
          this.removePeer(fromId);
          
          // Si on est Hôte, on propage l'info aux autres clients pour qu'ils le suppriment aussi
          if (this.role === OperatorRole.HOST) {
               // On broadcast le départ aux autres
               // (Les autres clients recevront CLIENT_LEAVING et exécuteront ce même bloc)
               this.broadcast({ type: 'CLIENT_LEAVING', id: fromId, callsign: callsign });
          }
          return; // On arrête le traitement ici pour ce message
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
          // On remplace la map complète pour être sûr de supprimer les fantômes
          // Mais on garde notre propre user
          const newMap: Record<string, UserData> = {};
          data.list.forEach((u: UserData) => {
              if (u.id !== this.user?.id) newMap[u.id] = u;
          });
          this.peersMap = newMap;
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
      this.isConnecting = false;
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
