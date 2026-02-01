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

const RECONNECT_INTERVAL = 5000;
const HEALTH_CHECK_INTERVAL = 10000;
const PEER_CREATION_TIMEOUT = 10000;

class ConnectivityService {
  private peer: Peer | null = null;
  private connections: Record<string, DataConnection> = {};
  private listeners: Listener[] = [];
  
  private user: UserData | null = null;
  private role: OperatorRole = OperatorRole.OPR;
  private targetHostId: string = '';
  
  // Stockage local des pairs (pour l'hôte qui doit maintenir la liste)
  private peersMap: Record<string, UserData> = {};

  private isConnecting = false;
  private isRefreshing = false;
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
      
      // Si je suis l'hôte, je m'ajoute moi-même à la liste des pairs
      if (this.role === OperatorRole.HOST && this.user) {
          this.peersMap = { [this.user.id]: this.user };
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
      } else {
          this.peersMap = {};
      }

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
              if (this.isRefreshing) return;

              console.error(`[Conn] Erreur: ${err.type}`);
              
              if (err.type === 'unavailable-id') {
                  console.warn("[Conn] ID pris. Attente...");
                  setTimeout(() => this.connectToPeerServer(forceId), 3000);
              } else if (err.type === 'peer-unavailable') {
                  this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
              } else if (err.type === 'network' || err.type === 'disconnected') {
                  // Géré par healthcheck
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
          // Un client rejette les connexions qui ne viennent pas de l'hôte
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
              // Le client envoie ses infos dès la connexion
              this.sendTo(conn.peer, { type: 'HELLO', user: this.user });
          } else {
              // L'hôte reçoit une connexion
              // On attend le message HELLO pour enregistrer l'utilisateur, mais on peut déjà initier
          }
      });

      conn.on('data', (data: any) => {
          this.handleDataMessage(data, conn.peer);
      });

      conn.on('close', () => {
          delete this.connections[conn.peer];
          
          // Si on est l'hôte, on retire le pair déconnecté de la liste et on diffuse
          if (this.role === OperatorRole.HOST) {
              if (this.peersMap[conn.peer]) {
                  delete this.peersMap[conn.peer];
                  this.broadcast({ type: 'SYNC_PEERS', peers: this.peersMap }); // Diffusion à tous
                  this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap }); // Mise à jour locale
              }
          }

          if (isOutgoingToHost && !this.isDestroyed && !this.isRefreshing) {
              this.notify({ type: 'DISCONNECTED', reason: 'NETWORK_ERROR' });
              this.connectToHost(conn.peer);
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

      // --- LOGIQUE HÔTE ---
      if (this.role === OperatorRole.HOST) {
          if (data.type === 'HELLO' || data.type === 'UPDATE_USER' || data.type === 'UPDATE') {
              // Mise à jour de la base de données locale des pairs
              if (data.user) {
                  this.peersMap[fromId] = { ...data.user, id: fromId };
                  // 1. Mettre à jour l'interface de l'hôte
                  this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
                  // 2. Diffuser la nouvelle liste complète à TOUS les clients
                  this.broadcast({ type: 'SYNC_PEERS', peers: this.peersMap });
              }
          }
          // Si l'hôte reçoit un broadcast (PING, etc), il doit le relayer aux autres
          else if (data.type === 'PING' || data.type === 'PING_MOVE' || data.type === 'PING_UPDATE' || data.type === 'PING_DELETE' || data.type === 'LOG_UPDATE') {
              this.notify({ type: 'DATA_RECEIVED', data, from: fromId }); // Pour l'hôte lui-même
              // Relayer à tout le monde SAUF l'émetteur
              Object.values(this.connections).forEach(conn => {
                  if (conn.open && conn.peer !== fromId) {
                      conn.send(data);
                  }
              });
          }
      } 
      // --- LOGIQUE CLIENT ---
      else {
          if (data.type === 'SYNC_PEERS') {
              // Réception de la liste complète depuis l'hôte
              this.peersMap = data.peers;
              this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
          } else {
              // Autres messages (PING, etc.)
              this.notify({ type: 'DATA_RECEIVED', data, from: fromId });
          }
      }
  }

  // --- ROBUSTESSE RÉSEAU ---
  private setupNetworkMonitor() {
      if (this.netInfoUnsubscribe) this.netInfoUnsubscribe();
      
      this.netInfoUnsubscribe = NetInfo.addEventListener(state => {
          const currentType = state.type;
          
          if (!state.isConnected) return;

          if (this.lastNetworkType && this.lastNetworkType !== currentType) {
              console.log(`[Net] Switch: ${this.lastNetworkType} -> ${currentType}`);
              if (this.networkSwitchTimeout) clearTimeout(this.networkSwitchTimeout);
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
          this.peer.disconnect();
          
          setTimeout(() => {
              if (this.peer && !this.peer.destroyed) {
                  try {
                      this.peer.reconnect();
                      setTimeout(() => { this.isRefreshing = false; }, 5000);
                  } catch (e) {
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
      // Si on est Hôte, on envoie à tout le monde
      // Si on est Client, on envoie à l'Hôte (qui relaiera)
      if (this.role === OperatorRole.HOST) {
          Object.values(this.connections).forEach(conn => {
              if (conn.open) conn.send(data);
          });
      } else if (this.targetHostId) {
          this.sendTo(this.targetHostId, data);
      }
  }

  public updateUser(partialUser: Partial<UserData>) {
      if (!this.user) return;
      this.user = { ...this.user, ...partialUser };
      
      // Mise à jour de la map locale si on est l'hôte
      if (this.role === OperatorRole.HOST) {
          this.peersMap[this.user.id] = this.user;
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap }); // MàJ UI Host
          this.broadcast({ type: 'SYNC_PEERS', peers: this.peersMap }); // Diffusion Clients
      } else {
          // Le client envoie ses modifications à l'hôte
          this.broadcast({ type: 'UPDATE_USER', user: this.user });
      }
  }
  
  public updateUserPosition(lat: number, lng: number, head: number) {
      if (!this.user) return;
      this.user = { ...this.user, lat, lng, head };
      
      // Même logique que updateUser
      if (this.role === OperatorRole.HOST) {
          this.peersMap[this.user.id] = this.user;
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
          this.broadcast({ type: 'SYNC_PEERS', peers: this.peersMap });
      } else {
          this.broadcast({ type: 'UPDATE', user: this.user });
      }
  }

  public kickUser(targetId: string) {
      if (this.role !== OperatorRole.HOST) return;
      this.sendTo(targetId, { type: 'KICK' });
      setTimeout(() => {
          const conn = this.connections[targetId];
          if(conn) conn.close();
          // Nettoyage liste
          delete this.peersMap[targetId];
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
          this.broadcast({ type: 'SYNC_PEERS', peers: this.peersMap });
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
      this.peersMap = {}; // Reset peers
      
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
