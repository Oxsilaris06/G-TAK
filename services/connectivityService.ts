import Peer, { DataConnection } from 'peerjs';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONFIG } from '../constants';
import { UserData, OperatorRole } from '../types';
import { AppStateStatus } from 'react-native';
// Nécessite: npm install lz-string
import { compress, decompress } from 'lz-string';

const STORAGE_KEY_ID = '@praxis_persistent_id';

export type ConnectivityEvent = 
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEERS_UPDATED'; peers: Record<string, UserData> }
  | { type: 'HOST_CONNECTED'; hostId: string }
  | { type: 'DISCONNECTED'; reason: 'KICKED' | 'NO_HOST' | 'NETWORK_ERROR' | 'MANUAL' | 'PEER_TIMEOUT' }
  | { type: 'RECONNECTING'; attempt: number }
  | { type: 'TOAST'; msg: string; level: 'info' | 'error' | 'success' | 'warning' }
  | { type: 'DATA_RECEIVED'; data: any; from: string }
  | { type: 'MIGRATION_START' }
  | { type: 'NEW_HOST_PROMOTED'; hostId: string };

type Listener = (event: ConnectivityEvent) => void;

interface PendingMessage {
  id: string;
  data: { targetId: string; payload: any };
  timestamp: number;
  retryCount: number;
  lastRetry: number;
}

const RECONNECT_INTERVAL = 5000;
const HEALTH_CHECK_INTERVAL = 10000;
const PEER_CREATION_TIMEOUT = 10000;
const ACK_TIMEOUT = 2000;
const MAX_RETRIES = 5;

class ConnectivityService {
  private peer: Peer | null = null;
  private connections: Record<string, DataConnection> = {};
  private listeners: Listener[] = [];
  
  private user: UserData | null = null;
  private role: OperatorRole = OperatorRole.OPR;
  private targetHostId: string = '';
  
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

  // --- SYSTEME ACK & ROBUSTESSE ---
  private pendingMessages: Map<string, PendingMessage> = new Map();
  private processedMessageIds: Set<string> = new Set(); 
  private ackCheckInterval: any;

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

  public async init(user: UserData, role: OperatorRole, targetHostId: string = '') {
      if (this.isConnecting) return;
      this.cleanup(false);
      
      this.isDestroyed = false;
      this.isConnecting = true;
      
      const persistentId = await this.getPersistentId();
      
      this.user = { ...user, id: persistentId };
      this.role = role;
      this.targetHostId = targetHostId;
      
      // CRITICAL: L'hôte doit s'ajouter lui-même à la liste dès le départ
      if (this.role === OperatorRole.HOST && this.user) {
          this.peersMap = { [this.user.id]: this.user };
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
      } else {
          this.peersMap = {};
      }

      this.setupNetworkMonitor();
      this.connectToPeerServer(persistentId);
      this.startHealthCheck();
      this.startAckSystem();
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
          } else if (this.role === OperatorRole.HOST) {
              // Si je suis l'hôte et qu'un client se connecte, je lui envoie tout de suite la situation tactique
              // Pas besoin d'attendre son HELLO pour sync les peers connus, mais on attend HELLO pour l'ajouter lui.
              // On peut envoyer un ACK de connexion.
          }
      });

      conn.on('data', (data: any) => {
          this.handleDataMessage(data, conn.peer);
      });

      conn.on('close', () => {
          delete this.connections[conn.peer];
          
          if (this.role === OperatorRole.HOST) {
              if (this.peersMap[conn.peer]) {
                  delete this.peersMap[conn.peer];
                  // Diffusion de la liste mise à jour à tout le monde
                  this.broadcast({ type: 'SYNC_PEERS', peers: this.peersMap });
                  this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
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
      // 1. Décompression
      if (data._compressed) {
          try {
              const str = decompress(data.payload);
              if (str) data = JSON.parse(str);
          } catch(e) { console.error("Decompression failed", e); return; }
      }

      // 2. Gestion ACK
      if (data.type === 'ACK') {
          if (this.pendingMessages.has(data.msgId)) {
              this.pendingMessages.delete(data.msgId);
          }
          return;
      }

      // 3. Renvoi ACK si demandé
      if (data._needsAck) {
          this.sendTo(fromId, { type: 'ACK', msgId: data._msgId });
      }

      // 4. Déduplication
      if (data._msgId) {
          if (this.processedMessageIds.has(data._msgId)) return;
          this.processedMessageIds.add(data._msgId);
          if (this.processedMessageIds.size > 1000) this.processedMessageIds.clear();
      }

      if (data.type === 'KICK') {
          this.cleanup(true);
          this.notify({ type: 'DISCONNECTED', reason: 'KICKED' });
          return;
      }

      // --- LOGIQUE HÔTE ---
      if (this.role === OperatorRole.HOST) {
          if (data.type === 'HELLO' || data.type === 'UPDATE_USER' || data.type === 'UPDATE') {
              if (data.user) {
                  // Mise à jour de la fiche du pair
                  this.peersMap[fromId] = { ...data.user, id: fromId };
                  
                  this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
                  
                  // CRITICAL: Rediffuser la liste complète à TOUS les clients (dont celui qui vient d'arriver)
                  this.broadcast({ type: 'SYNC_PEERS', peers: this.peersMap });
              }
          }
          // Relayer les autres types de messages
          else if (['PING', 'PING_MOVE', 'PING_UPDATE', 'PING_DELETE', 'LOG_UPDATE'].includes(data.type)) {
              this.notify({ type: 'DATA_RECEIVED', data, from: fromId });
              // Relayer à tout le monde SAUF l'émetteur
              Object.values(this.connections).forEach(conn => {
                  if (conn.open && conn.peer !== fromId) {
                      this.sendInternal(conn, data);
                  }
              });
          }
      } 
      // --- LOGIQUE CLIENT ---
      else {
          if (data.type === 'SYNC_PEERS') {
              // Mise à jour de la liste locale avec celle de l'hôte
              this.peersMap = data.peers;
              this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
          } else {
              this.notify({ type: 'DATA_RECEIVED', data, from: fromId });
          }
      }
  }

  // --- API PUBLIQUE AMÉLIORÉE ---

  public sendTo(targetId: string, data: any) {
      const conn = this.connections[targetId];
      if (conn && conn.open) {
          this.sendInternal(conn, data);
      }
  }

  public async sendToWithAck(targetId: string, data: any): Promise<void> {
      const msgId = Math.random().toString(36).substr(2, 9);
      const payload = { ...data, _msgId: msgId, _needsAck: true };

      return new Promise((resolve) => {
        this.pendingMessages.set(msgId, {
             id: msgId,
             data: { targetId, payload },
             timestamp: Date.now(),
             retryCount: 0,
             lastRetry: Date.now()
        });
        this.sendTo(targetId, payload);
        resolve(); // Optimiste
      });
  }

  public async broadcastWithAck(data: any): Promise<void> {
      const promises: Promise<void>[] = [];
      if (this.role === OperatorRole.HOST) {
          Object.keys(this.connections).forEach(id => {
              promises.push(this.sendToWithAck(id, data));
          });
      } else if (this.targetHostId) {
          promises.push(this.sendToWithAck(this.targetHostId, data));
      }
      await Promise.all(promises);
  }

  public broadcast(data: any) {
      if (this.role === OperatorRole.HOST) {
          Object.values(this.connections).forEach(conn => {
              if (conn.open) this.sendInternal(conn, data);
          });
      } else if (this.targetHostId) {
          this.sendTo(this.targetHostId, data);
      }
  }

  private sendInternal(conn: DataConnection, data: any) {
      try {
          if (['SYNC_PEERS', 'LOG_UPDATE'].includes(data.type)) {
              const jsonStr = JSON.stringify(data);
              const compressed = compress(jsonStr);
              conn.send({ _compressed: true, payload: compressed });
          } else {
              conn.send(data);
          }
      } catch (e) {
          console.error("Send failed", e);
      }
  }

  // --- SYSTÈME ACK & RETRY ---
  private startAckSystem() {
      if (this.ackCheckInterval) clearInterval(this.ackCheckInterval);
      this.ackCheckInterval = setInterval(() => {
          const now = Date.now();
          this.pendingMessages.forEach((pending, key) => {
              if (now - pending.lastRetry > ACK_TIMEOUT) {
                  if (pending.retryCount < MAX_RETRIES) {
                      pending.retryCount++;
                      pending.lastRetry = now;
                      this.sendTo(pending.data.targetId, pending.data.payload);
                  } else {
                      this.pendingMessages.delete(key);
                      // Silent fail or toast
                  }
              }
          });
      }, 1000);
  }

  public updateUser(partialUser: Partial<UserData>) {
      if (!this.user) return;
      this.user = { ...this.user, ...partialUser };
      
      if (this.role === OperatorRole.HOST) {
          this.peersMap[this.user.id] = this.user;
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
          this.broadcast({ type: 'SYNC_PEERS', peers: this.peersMap });
      } else {
          // Client envoie update à l'hôte
          this.broadcast({ type: 'UPDATE_USER', user: this.user });
      }
  }
  
  public updateUserPosition(lat: number, lng: number, head: number) {
      if (!this.user) return;
      this.user = { ...this.user, lat, lng, head };
      
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

  private setupNetworkMonitor() {
      if (this.netInfoUnsubscribe) this.netInfoUnsubscribe();
      
      this.netInfoUnsubscribe = NetInfo.addEventListener(state => {
          const currentType = state.type;
          
          if (!state.isConnected) return;

          if (this.lastNetworkType && this.lastNetworkType !== currentType) {
              if (this.networkSwitchTimeout) clearTimeout(this.networkSwitchTimeout);
              this.networkSwitchTimeout = setTimeout(() => this.refreshConnection(), 2000);
          }
          this.lastNetworkType = currentType;
      });
  }
  
  public refreshConnection() {
      if (this.isRefreshing || this.isDestroyed) return;
      
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
      if (this.ackCheckInterval) clearInterval(this.ackCheckInterval);
      if (this.networkSwitchTimeout) clearTimeout(this.networkSwitchTimeout);
      
      if (full && this.netInfoUnsubscribe) {
          this.netInfoUnsubscribe();
          this.netInfoUnsubscribe = null;
      }
      
      Object.values(this.connections).forEach(c => { try { c.close(); } catch(e) {} });
      this.connections = {};
      this.peersMap = {}; 
      this.pendingMessages.clear();
      this.processedMessageIds.clear();
      
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
