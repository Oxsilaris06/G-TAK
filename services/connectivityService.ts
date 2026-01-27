import Peer, { DataConnection } from 'peerjs';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONFIG } from '../constants';
import { UserData, OperatorRole, OperatorStatus } from '../types';
import { AppStateStatus } from 'react-native';

const STORAGE_KEY_ID = '@praxis_persistent_id';

export type ConnectivityEvent = 
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEERS_UPDATED'; peers: Record<string, UserData> }
  | { type: 'HOST_CONNECTED'; hostId: string }
  | { type: 'DISCONNECTED'; reason: 'KICKED' | 'NO_HOST' | 'NETWORK_ERROR' | 'MANUAL' }
  | { type: 'RECONNECTING'; attempt: number }
  | { type: 'TOAST'; msg: string; level: 'info' | 'error' | 'success' | 'warning' }
  | { type: 'DATA_RECEIVED'; data: any; from: string }
  | { type: 'MIGRATION_START' }
  | { type: 'NEW_HOST_PROMOTED'; hostId: string };

type Listener = (event: ConnectivityEvent) => void;

const RECONNECT_INTERVAL = 5000; // Augmenté pour éviter le spam
const HEALTH_CHECK_INTERVAL = 10000;
const PEER_CREATION_TIMEOUT = 10000;

class ConnectivityService {
  private peer: Peer | null = null;
  private connections: Record<string, DataConnection> = {};
  private listeners: Listener[] = [];
  
  private user: UserData | null = null;
  private role: OperatorRole = OperatorRole.OPR;
  private targetHostId: string = '';
  
  private isConnecting = false;
  private isRefreshing = false; // Verrou pour éviter la boucle
  private isDestroyed = false;
  private reconnectAttempts = 0;
  
  private retryTimeout: any;
  private healthCheckInterval: any;
  private networkSwitchTimeout: any;
  private creationTimeout: any;
  
  private netInfoUnsubscribe: (() => void) | null = null;
  private lastNetworkType: string | null = null;

  // --- IDENTITÉ PERSISTANTE ---
  private async getPersistentId(): Promise<string> {
      try {
          const savedId = await AsyncStorage.getItem(STORAGE_KEY_ID);
          if (savedId) return savedId;
          const newId = this.generateShortId();
          await AsyncStorage.setItem(STORAGE_KEY_ID, newId);
          return newId;
      } catch (error) {
          return this.generateShortId();
      }
  }

  private generateShortId(): string {
      return Math.random().toString(36).substr(2, 9).toUpperCase();
  }

  // --- INITIALISATION ---
  public async init(user: UserData, role: OperatorRole, targetHostId: string = '') {
      if (this.isConnecting) return;
      this.cleanup(false);
      
      this.isDestroyed = false;
      this.isConnecting = true;
      
      const persistentId = await this.getPersistentId();
      
      this.user = { ...user, id: persistentId };
      this.role = role;
      this.targetHostId = targetHostId;

      this.setupNetworkMonitor();
      this.connectToPeerServer(persistentId);
      this.startHealthCheck();
  }

  private connectToPeerServer(forceId: string) {
      if (this.peer) { 
          try { this.peer.destroy(); } catch(e) {}
      }

      console.log(`[Conn] Init PeerJS ID: ${forceId}`);

      try {
          this.peer = new Peer(forceId, CONFIG.PEER_CONFIG);

          this.creationTimeout = setTimeout(() => {
              if (this.peer && !this.peer.open) {
                  console.warn("[Conn] Timeout - Relance");
                  this.handleConnectionError(new Error("Timeout Creation"));
              }
          }, PEER_CREATION_TIMEOUT);

          this.peer.on('open', (id) => {
              clearTimeout(this.creationTimeout);
              this.isConnecting = false;
              this.isRefreshing = false;
              this.reconnectAttempts = 0;
              console.log(`[Conn] OK: ${id}`);
              this.notify({ type: 'PEER_OPEN', id });
              
              if (this.role === OperatorRole.OPR && this.targetHostId) {
                  this.connectToHost(this.targetHostId);
              }
          });

          this.peer.on('connection', (conn) => {
              this.handleIncomingConnection(conn);
          });

          this.peer.on('error', (err: any) => {
              clearTimeout(this.creationTimeout);
              // Ignore l'erreur "Lost connection" si on est déjà en train de refresh
              if (this.isRefreshing) return;

              console.error(`[Conn] Erreur: ${err.type}`);
              
              if (err.type === 'unavailable-id') {
                  console.warn("[Conn] ID pris. Attente...");
                  setTimeout(() => this.connectToPeerServer(forceId), 3000);
              } else if (err.type === 'peer-unavailable') {
                  this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
              } else if (err.type === 'network' || err.type === 'disconnected') {
                  // On ne fait rien ici, le healthcheck ou le network monitor gérera
              } else {
                  this.handleConnectionError(err);
              }
          });

      } catch (e) {
          this.handleConnectionError(e);
      }
  }

  private connectToHost(hostId: string) {
      if (!this.peer || this.peer.destroyed || !this.peer.open) return;
      
      // Évite les doublons de connexion
      if (this.connections[hostId] && this.connections[hostId].open) return;

      console.log(`[Link] Connexion vers Hôte...`);
      try {
          const conn = this.peer.connect(hostId, {
              reliable: true,
              metadata: { user: this.user, version: '2.0-MILSPEC' }
          });
          this.setupConnectionEvents(conn, true);
      } catch (e) {
          console.error("[Link] Echec", e);
      }
  }

  private handleIncomingConnection(conn: DataConnection) {
      if (this.role === OperatorRole.OPR && conn.peer !== this.targetHostId) {
          conn.close();
          return;
      }
      this.setupConnectionEvents(conn, false);
  }

  private setupConnectionEvents(conn: DataConnection, isOutgoingToHost: boolean) {
      conn.on('open', () => {
          this.connections[conn.peer] = conn;
          if (isOutgoingToHost) {
              this.notify({ type: 'HOST_CONNECTED', hostId: conn.peer });
              this.sendTo(conn.peer, { type: 'HELLO', user: this.user });
          }
      });

      conn.on('data', (data: any) => {
          this.handleDataMessage(data, conn.peer);
      });

      conn.on('close', () => {
          delete this.connections[conn.peer];
          if (isOutgoingToHost && !this.isDestroyed && !this.isRefreshing) {
              this.notify({ type: 'DISCONNECTED', reason: 'NETWORK_ERROR' });
              this.connectToHost(conn.peer); // Tentative immédiate de reconnexion au tunnel
          }
      });
      
      conn.on('error', (e) => conn.close());
  }

  private handleDataMessage(data: any, fromId: string) {
      if (data.type === 'KICK') {
          this.cleanup(true);
          this.notify({ type: 'DISCONNECTED', reason: 'KICKED' });
          return;
      }
      this.notify({ type: 'DATA_RECEIVED', data, from: fromId });
      if (data.type === 'SYNC_PEERS' || data.type === 'PEERS_UPDATED') {
          this.notify({ type: 'PEERS_UPDATED', peers: data.peers });
      }
  }

  // --- ROBUSTESSE RÉSEAU (ANTI-BOUCLE) ---
  private setupNetworkMonitor() {
      if (this.netInfoUnsubscribe) this.netInfoUnsubscribe();
      
      this.netInfoUnsubscribe = NetInfo.addEventListener(state => {
          const currentType = state.type;
          
          // On ignore si pas de réseau
          if (!state.isConnected) return;

          // Détection changement interface (Wifi <-> 4G)
          if (this.lastNetworkType && this.lastNetworkType !== currentType) {
              console.log(`[Net] Switch: ${this.lastNetworkType} -> ${currentType}`);
              
              if (this.networkSwitchTimeout) clearTimeout(this.networkSwitchTimeout);
              
              // On attend 2s pour être sûr que l'IP est stable avant de refresh
              // C'est ce délai qui empêche la boucle infinie
              this.networkSwitchTimeout = setTimeout(() => this.refreshConnection(), 2000);
          }
          this.lastNetworkType = currentType;
      });
  }
  
  public refreshConnection() {
      if (this.isRefreshing || this.isDestroyed) return;
      
      console.log("[Net] Refresh Sécurisé...");
      this.isRefreshing = true;

      if (this.peer) {
          // On coupe tout proprement
          this.peer.disconnect();
          
          setTimeout(() => {
              if (this.peer && !this.peer.destroyed) {
                  try {
                      this.peer.reconnect();
                      // On relâche le verrou après 5s pour laisser le temps à la reco de finir
                      setTimeout(() => { this.isRefreshing = false; }, 5000);
                  } catch (e) {
                      // Si échec fatal, reset complet
                      this.isRefreshing = false;
                      this.handleConnectionError(new Error("Refresh Failed"));
                  }
              } else {
                  this.isRefreshing = false;
              }
          }, 1500);
      } else {
          this.isRefreshing = false;
      }
  }

  private handleConnectionError(error: any) {
      if (this.isDestroyed || this.isRefreshing) return;
      this.scheduleReconnect();
  }

  private scheduleReconnect() {
      if (this.retryTimeout) clearTimeout(this.retryTimeout);
      this.retryTimeout = setTimeout(() => {
          if (!this.isDestroyed && this.user) {
              this.reconnectAttempts++;
              this.notify({ type: 'RECONNECTING', attempt: this.reconnectAttempts });
              this.connectToPeerServer(this.user.id); 
          }
      }, RECONNECT_INTERVAL);
  }

  // --- API PUBLIQUE ---
  public sendTo(targetId: string, data: any) {
      const conn = this.connections[targetId];
      if (conn && conn.open) conn.send(data);
  }

  public broadcast(data: any) {
      Object.values(this.connections).forEach(conn => {
          if (conn.open) conn.send(data);
      });
  }

  public updateUser(partialUser: Partial<UserData>) {
      if (!this.user) return;
      this.user = { ...this.user, ...partialUser };
      this.broadcast({ type: 'UPDATE_USER', user: this.user });
  }
  
  public updateUserPosition(lat: number, lng: number, head: number) {
      if (!this.user) return;
      this.user = { ...this.user, lat, lng, head };
      // Broadcast optimisé : UDP-like (pas de garantie d'ordre critique)
      this.broadcast({ type: 'UPDATE', user: { id: this.user.id, lat, lng, head, callsign: this.user.callsign, status: this.user.status } });
  }

  public kickUser(targetId: string) {
      if (this.role !== OperatorRole.HOST) return;
      this.sendTo(targetId, { type: 'KICK' });
      setTimeout(() => {
          const conn = this.connections[targetId];
          if(conn) conn.close();
      }, 500);
  }

  public handleAppStateChange(status: AppStateStatus) {
      if (status === 'active') {
          if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
              try { this.peer.reconnect(); } catch(e) {}
          }
      }
  }

  private startHealthCheck() {
      if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = setInterval(() => {
          if (this.isDestroyed || this.isRefreshing) return;
          
          if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
              try { this.peer.reconnect(); } catch(e) {}
          }
          
          if (this.role === OperatorRole.OPR && this.targetHostId) {
             const hostConn = this.connections[this.targetHostId];
             if (!hostConn || !hostConn.open) {
                 this.connectToHost(this.targetHostId);
             }
          }
      }, HEALTH_CHECK_INTERVAL);
  }

  public cleanup(full = true) {
      this.isDestroyed = full;
      this.isConnecting = false;
      this.isRefreshing = false;
      if (this.retryTimeout) clearTimeout(this.retryTimeout);
      if (this.creationTimeout) clearTimeout(this.creationTimeout);
      if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
      if (this.networkSwitchTimeout) clearTimeout(this.networkSwitchTimeout);
      
      if (full && this.netInfoUnsubscribe) {
          this.netInfoUnsubscribe();
          this.netInfoUnsubscribe = null;
      }
      
      Object.values(this.connections).forEach(c => { try { c.close(); } catch(e) {} });
      this.connections = {};
      
      if (this.peer) {
          try { this.peer.destroy(); } catch(e) {}
          this.peer = null;
      }
  }

  public subscribe(listener: Listener) {
      this.listeners.push(listener);
      return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private notify(event: ConnectivityEvent) {
      this.listeners.forEach(l => l(event));
  }
}

export const connectivityService = new ConnectivityService();
