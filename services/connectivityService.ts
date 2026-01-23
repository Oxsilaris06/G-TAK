import Peer, { DataConnection } from 'peerjs';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { CONFIG } from '../constants';
import { UserData, OperatorRole, OperatorStatus } from '../types';
import { AppStateStatus } from 'react-native';

export type ConnectivityEvent = 
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEERS_UPDATED'; peers: Record<string, UserData> }
  | { type: 'HOST_CONNECTED'; hostId: string }
  | { type: 'DISCONNECTED'; reason: 'KICKED' | 'NO_HOST' | 'NETWORK_ERROR' | 'MANUAL' }
  | { type: 'RECONNECTING'; attempt: number }
  | { type: 'TOAST'; msg: string; level: 'info' | 'error' | 'success' | 'warning' }
  | { type: 'DATA_RECEIVED'; data: any; from: string }
  | { type: 'MIGRATION_START' }
  | { type: 'NEW_HOST_PROMOTED'; hostId: string }
  // NOUVEAU : Event pour synchroniser l'UI avec le tracking background
  | { type: 'LOCAL_POSITION_UPDATE'; lat: number; lng: number; head: number };

type Listener = (event: ConnectivityEvent) => void;

const RECONNECT_INTERVAL = 3000;
const SYNC_INTERVAL = 2000;
const HANDSHAKE_RETRY = 1000;
const PEER_CREATION_TIMEOUT = 5000; 

// --- TIMEOUTS DE SURVIE (WATCHDOG) ---
const HEALTH_CHECK_INTERVAL = 5000; 
const HOST_TIMEOUT = 15000;         
const ZOMBIE_TIMEOUT = 30000;       

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
  private creationTimeout: any = null;
  private healthCheckInterval: any = null;
  private networkSwitchTimeout: any = null;
  
  private lastHostActivity: number = Date.now();
  private lastPeerActivity: Record<string, number> = {};

  private netInfoUnsubscribe: (() => void) | null = null;
  private lastNetworkType: string | null = null;
  
  private isDestroyed = false;
  private isConnecting = false;

  constructor() {
      this.setupNetworkMonitor();
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private notify(event: ConnectivityEvent) {
    this.listeners.forEach(l => l(event));
  }
  
  private setupNetworkMonitor() {
      this.netInfoUnsubscribe = NetInfo.addEventListener(state => {
          if (!state.isConnected) return;
          const currentType = state.type;
          
          if (this.lastNetworkType && this.lastNetworkType !== currentType) {
              console.log(`[NET] Changement Réseau détecté: ${this.lastNetworkType} -> ${currentType}`);
              this.handleNetworkSwitch();
          }
          this.lastNetworkType = currentType;
      });
  }

  private handleNetworkSwitch() {
      if (this.isDestroyed) return;

      console.log("[NET] Reconstruction forcée du lien réseau...");
      this.notify({ type: 'TOAST', msg: 'Changement réseau : Reconnexion...', level: 'warning' });

      if (this.networkSwitchTimeout) clearTimeout(this.networkSwitchTimeout);

      Object.values(this.connections).forEach(c => { try { c.close(); } catch(e){} });
      this.connections = {};

      if (this.peer) {
          try { this.peer.destroy(); } catch(e) { console.warn("Erreur destroy peer:", e); }
          this.peer = null;
      }
      this.isConnecting = false;

      this.networkSwitchTimeout = setTimeout(() => {
          const targetId = this.user?.id;
          console.log(`[NET] Tentative de récupération ID: ${targetId || 'Aucun'} (apres 2s)`);
          this.createPeer(targetId, 5);
      }, 2000);
  }

  public handleAppStateChange(status: AppStateStatus) {
      if (status === 'active') {
          if (!this.peer || this.peer.disconnected || this.peer.destroyed) {
              console.log("[NET] Retour premier plan : Vérification connexion...");
              this.scheduleReconnect(true);
          }
          this.lastHostActivity = Date.now();
      }
  }

  public async init(user: UserData, role: OperatorRole, targetHostId?: string) {
    this.cleanup(false);
    this.isDestroyed = false;
    
    this.user = { ...user, role };
    this.role = role;
    this.hostId = targetHostId || null;
    this.lastHostActivity = Date.now();

    const myId = role === OperatorRole.HOST ? this.generateShortId() : undefined; 
    
    console.log(`[NET] Init. Role: ${role}, TargetHost: ${targetHostId}`);
    this.createPeer(myId);
    
    this.startHealthCheck();
  }

  private startHealthCheck() {
      if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
      
      this.healthCheckInterval = setInterval(() => {
          if (this.isDestroyed || this.isConnecting) return;
          const now = Date.now();

          if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
              this.peer.reconnect();
          }

          if (this.role === OperatorRole.OPR && this.hostId) {
              const hasConnection = !!this.connections[this.hostId];
              if (hasConnection && (now - this.lastHostActivity > HOST_TIMEOUT)) {
                  console.warn(`[WATCHDOG] Hôte silencieux depuis ${Math.round((now - this.lastHostActivity)/1000)}s. Reconnexion forcée.`);
                  this.scheduleReconnect(true); 
                  this.lastHostActivity = now;
              }
          }

          if (this.role === OperatorRole.HOST) {
              Object.keys(this.connections).forEach(peerId => {
                  const lastSeen = this.lastPeerActivity[peerId] || now;
                  if (now - lastSeen > ZOMBIE_TIMEOUT) {
                      const conn = this.connections[peerId];
                      if (conn) { 
                          try { conn.close(); } catch(e){} 
                          delete this.connections[peerId];
                      }
                      delete this.lastPeerActivity[peerId];
                      this.removePeer(peerId);
                  }
              });
          }
      }, HEALTH_CHECK_INTERVAL);
  }

  private createPeer(id?: string, attempts: number = 1) {
    if (this.isConnecting) return;
    this.isConnecting = true;

    if (this.creationTimeout) clearTimeout(this.creationTimeout);

    try {
        console.log(`[NET] Création Peer (Tentative avec ID: ${id || 'AUTO'}, Essais restants: ${attempts})...`);
        const peer = new Peer(id, CONFIG.PEER_CONFIG as any);
        this.peer = peer;

        this.creationTimeout = setTimeout(() => {
            if (!peer.open) {
                console.warn("[NET] Timeout création Peer (>5s). Reset forcé.");
                this.isConnecting = false;
                try { peer.destroy(); } catch(e) {}
                this.createPeer(id, attempts);
            }
        }, PEER_CREATION_TIMEOUT);

        peer.on('open', (peerId) => {
            if (this.creationTimeout) clearTimeout(this.creationTimeout);
            
            this.isConnecting = false;
            console.log(`[NET] Peer OPEN: ${peerId}`);
            if (this.user) this.user.id = peerId;
            this.notify({ type: 'PEER_OPEN', id: peerId });
            this.lastHostActivity = Date.now(); 

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
            console.log(`[NET] Connexion entrante de ${conn.peer}`);
            this.setupConnection(conn);
        });

        peer.on('error', (err: any) => {
            this.isConnecting = false;
            console.error(`[NET] Peer Error: ${err.type}`, err);
            
            if (err.type === 'unavailable-id') {
                if (id && attempts > 1) {
                    setTimeout(() => this.createPeer(id, attempts - 1), 2000);
                    return;
                }
                
                let nextId = undefined;
                if (this.role === OperatorRole.HOST) {
                    this.notify({ type: 'TOAST', msg: 'ID Hôte indisponible, nouvel ID...', level: 'warning' });
                    nextId = this.generateShortId();
                } 
                else if (this.role === OperatorRole.OPR && id) {
                    const suffix = Math.floor(Math.random() * 1000);
                    nextId = `${id}-${suffix}`;
                    this.notify({ type: 'TOAST', msg: `ID bloqué. Suffixe ajouté: ${nextId}`, level: 'warning' });
                }
                setTimeout(() => this.createPeer(nextId), 500);

            } else if (err.type === 'peer-unavailable') {
                if (!this.isDestroyed && this.role === OperatorRole.OPR) {
                   this.scheduleReconnect();
                }
            } else {
                this.scheduleReconnect();
            }
        });

        peer.on('disconnected', () => {
            if (!this.isDestroyed && this.peer && !this.peer.destroyed) {
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
      if (this.isDestroyed) return;

      const delay = immediate ? 200 : RECONNECT_INTERVAL;

      this.retryTimeout = setTimeout(() => {
          if (this.peer) {
              try { this.peer.destroy(); } catch(e) {}
              this.peer = null;
          }
          const targetId = this.user?.id;
          this.createPeer(targetId);
      }, delay);
  }

  public connectToHost(targetId: string) {
      if (!this.peer || this.peer.destroyed) return;
      
      if (this.connections[targetId]) {
          try { this.connections[targetId].close(); } catch(e) {}
          delete this.connections[targetId];
      }

      const conn = this.peer.connect(targetId, { 
          reliable: true,
          serialization: 'json',
          metadata: { role: 'OPR', version: '4.0.0' }
      });
      
      this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection) {
      const connTimeout = setTimeout(() => {
          if (!conn.open) {
              try { conn.close(); } catch(e) {}
          }
      }, 8000);

      conn.on('open', () => {
          clearTimeout(connTimeout);
          this.connections[conn.peer] = conn;
          this.lastPeerActivity[conn.peer] = Date.now(); 

          if (this.role === OperatorRole.HOST) {
              this.sendSync(conn);
          } else {
              this.notify({ type: 'HOST_CONNECTED', hostId: conn.peer });
              this.startClientHandshake(conn);
          }
      });

      conn.on('data', (data) => this.handleData(data, conn.peer));
      
      conn.on('close', () => {
          this.removePeer(conn.peer); 
          if (this.role === OperatorRole.OPR && conn.peer === this.hostId) {
              this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
              this.scheduleReconnect(true);
          }
      });
      
      conn.on('error', (err) => {
          try { conn.close(); } catch(e) {}
      });
  }

  private removePeer(peerId: string) {
      if (this.connections[peerId]) {
          delete this.connections[peerId];
      }
      if (this.peersMap[peerId]) {
          delete this.peersMap[peerId];
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
      }
      if (this.lastPeerActivity[peerId]) delete this.lastPeerActivity[peerId];
  }

  private startClientHandshake(conn: DataConnection) {
      if (this.handshakeInterval) clearInterval(this.handshakeInterval);
      conn.send({ type: 'HELLO', user: this.user });
      this.handshakeInterval = setInterval(() => {
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
      this.lastPeerActivity[fromId] = Date.now();
      if (fromId === this.hostId) {
          this.lastHostActivity = Date.now();
      }

      if (this.role === OperatorRole.OPR && data.type === 'SYNC') {
          if (this.handshakeInterval) {
              clearInterval(this.handshakeInterval);
              this.handshakeInterval = null;
              this.notify({ type: 'TOAST', msg: 'Synchronisé', level: 'success' });
          }
      }

      if (data.type === 'CLIENT_LEAVING') {
          const callsign = data.callsign || fromId.substring(0,4);
          this.notify({ type: 'TOAST', msg: `${callsign} a quitté.`, level: 'info' });
          this.removePeer(fromId);
          if (this.role === OperatorRole.HOST) {
               this.broadcast({ type: 'CLIENT_LEAVING', id: fromId, callsign: callsign });
          }
          return; 
      }
      
      if (data.type === 'RALLY_REQ') {
          this.notify({ type: 'TOAST', msg: `${data.sender} vous rejoint !`, level: 'info' });
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
  
  // --- MODIFIÉ POUR BACKBONE ---
  // Appelé manuellement par App.tsx OU par la tâche de fond
  public updateUserPosition(lat: number, lng: number, head: number) {
      this.handleBackgroundLocation(lat, lng, head);
  }
  
  // NOUVEAU : Point d'entrée pour la tâche de fond
  public handleBackgroundLocation(lat: number, lng: number, head: number) {
      if (!this.user) return;
      
      this.user = { ...this.user, lat, lng, head };
      
      // 1. On informe les autres (WebRTC)
      this.broadcast({ type: 'UPDATE_USER', user: this.user });
      
      // 2. On informe notre propre UI (App.tsx) pour qu'elle se mette à jour
      // Car App.tsx n'écoute pas la tâche de fond directement
      this.notify({ type: 'LOCAL_POSITION_UPDATE', lat, lng, head });
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
      if (this.creationTimeout) clearTimeout(this.creationTimeout);
      if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
      if (this.networkSwitchTimeout) clearTimeout(this.networkSwitchTimeout);
      
      if (full && this.netInfoUnsubscribe) {
          this.netInfoUnsubscribe();
          this.netInfoUnsubscribe = null;
      }
      
      Object.values(this.connections).forEach(c => { try { c.close(); } catch(e){} });
      this.connections = {};
      this.peersMap = {};
      this.lastPeerActivity = {};
      
      if (this.peer) {
          try { this.peer.destroy(); } catch(e) {}
          this.peer = null;
      }
  }

  private generateShortId(): string {
      return Math.random().toString(36).substring(2, 7).toUpperCase();
  }
}

export const connectivityService = new ConnectivityService();
