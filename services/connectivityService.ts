import Peer, { DataConnection } from 'peerjs';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONFIG } from '../constants';
import { UserData, OperatorRole } from '../types';
import { AppStateStatus } from 'react-native';

// --- CONFIGURATION ---
const STORAGE_KEY_ID = '@praxis_persistent_id';

// Délais et Timeouts pour la robustesse
const RECONNECT_INTERVAL = 5000;
const HEALTH_CHECK_INTERVAL = 10000;
const PEER_CREATION_TIMEOUT = 10000;
const ACK_TIMEOUT = 2000; // Temps d'attente avant renvoi (2s)
const MAX_RETRIES = 5;    // Nombre d'essais max

// --- TYPES ---
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

class ConnectivityService {
  private peer: Peer | null = null;
  private connections: Record<string, DataConnection> = {};
  private listeners: Listener[] = [];
  
  private user: UserData | null = null;
  private role: OperatorRole = OperatorRole.OPR;
  private targetHostId: string = '';
  
  // Base de données locale des pairs (Source de vérité)
  private peersMap: Record<string, UserData> = {};

  // États de connexion
  private isConnecting = false;
  private isRefreshing = false;
  private isDestroyed = false;
  private reconnectAttempts = 0;
  
  // Timers
  private retryTimeout: any;
  private healthCheckInterval: any;
  private networkSwitchTimeout: any;
  private creationTimeout: any;
  
  // Monitoring Réseau
  private netInfoUnsubscribe: (() => void) | null = null;
  private lastNetworkType: string | null = null;

  // --- SYSTÈME ACK (Fiabilité) ---
  // Stocke les messages en attente de confirmation
  private pendingMessages: Map<string, PendingMessage> = new Map();
  // Stocke les IDs des messages déjà traités pour éviter les doublons
  private processedMessageIds: Set<string> = new Set(); 
  private ackCheckInterval: any;

  // --- GESTION ID PERSISTANT ---
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
      
      // IMPORTANT: Si je suis l'hôte, je m'ajoute moi-même à la liste immédiatement
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

  // --- CONNEXION PEERJS ---
  private connectToPeerServer(forceId: string) {
      if (this.peer) { 
          try { this.peer.destroy(); } catch(e) {}
      }

      console.log(`[Conn] Init PeerJS ID: ${forceId}`);

      try {
          this.peer = new Peer(forceId, CONFIG.PEER_CONFIG);

          // Sécurité anti-blocage (si PeerJS ne répond jamais)
          this.creationTimeout = setTimeout(() => {
              if (this.peer && !this.peer.open) {
                  console.warn("[Conn] Timeout Creation - Relance");
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
              
              // Si on est Client, on se connecte à l'Hôte
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

              console.error(`[Conn] Erreur: ${err.type}`, err);
              
              if (err.type === 'unavailable-id') {
                  // Si l'ID est pris (conflit fantôme), on réessaie plus tard
                  setTimeout(() => this.connectToPeerServer(forceId), 3000);
              } else if (err.type === 'peer-unavailable') {
                  this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
              } else if (err.type === 'network' || err.type === 'disconnected') {
                  // Géré par le healthcheck
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
              metadata: { user: this.user, version: '2.1-NOCOMPRESS' }
          });
          this.setupConnectionEvents(conn, true);
      } catch (e) {
          console.error("[Link] Echec", e);
      }
  }

  private handleIncomingConnection(conn: DataConnection) {
      // Sécurité: Si je suis Client, je n'accepte que l'Hôte
      if (this.role === OperatorRole.OPR && conn.peer !== this.targetHostId) {
          console.log(`[Secu] Rejet connexion inconnue de ${conn.peer}`);
          conn.close();
          return;
      }
      this.setupConnectionEvents(conn, false);
  }

  private setupConnectionEvents(conn: DataConnection, isOutgoingToHost: boolean) {
      conn.on('open', () => {
          console.log(`[Link] Ouvert avec ${conn.peer}`);
          this.connections[conn.peer] = conn;
          
          if (isOutgoingToHost) {
              this.notify({ type: 'HOST_CONNECTED', hostId: conn.peer });
              // Le Client envoie ses infos dès que ça ouvre
              this.sendTo(conn.peer, { type: 'HELLO', user: this.user });
          }
      });

      conn.on('data', (data: any) => {
          this.handleDataMessage(data, conn.peer);
      });

      conn.on('close', () => {
          console.log(`[Link] Fermé avec ${conn.peer}`);
          delete this.connections[conn.peer];
          
          // Si je suis Hôte, je retire le client qui part
          if (this.role === OperatorRole.HOST) {
              if (this.peersMap[conn.peer]) {
                  delete this.peersMap[conn.peer];
                  // Je préviens tout le monde
                  this.broadcast({ type: 'SYNC_PEERS', peers: this.peersMap });
                  this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
              }
          }

          // Si je suis Client et que je perds l'Hôte
          if (isOutgoingToHost && !this.isDestroyed && !this.isRefreshing) {
              this.notify({ type: 'DISCONNECTED', reason: 'NETWORK_ERROR' });
              // Tentative de reconnexion immédiate
              setTimeout(() => this.connectToHost(conn.peer), 1000);
          }
      });
      
      conn.on('error', (e) => {
          console.error(`[Link] Erreur avec ${conn.peer}`, e);
          conn.close();
      });
  }

  // --- TRAITEMENT DES MESSAGES ---
  private handleDataMessage(data: any, fromId: string) {
      // 1. Gestion ACK (Accusé de réception)
      if (data.type === 'ACK') {
          if (this.pendingMessages.has(data.msgId)) {
              // console.log(`[Ack] Reçu pour ${data.msgId}`);
              this.pendingMessages.delete(data.msgId);
          }
          return;
      }

      // 2. Renvoi ACK si demandé par l'émetteur
      if (data._needsAck) {
          this.sendTo(fromId, { type: 'ACK', msgId: data._msgId });
      }

      // 3. Déduplication (éviter de traiter 2 fois le même message)
      if (data._msgId) {
          if (this.processedMessageIds.has(data._msgId)) return; // Déjà vu
          this.processedMessageIds.add(data._msgId);
          // Nettoyage périodique simple
          if (this.processedMessageIds.size > 1000) this.processedMessageIds.clear();
      }

      if (data.type === 'KICK') {
          this.cleanup(true);
          this.notify({ type: 'DISCONNECTED', reason: 'KICKED' });
          return;
      }

      // --- LOGIQUE HÔTE ---
      if (this.role === OperatorRole.HOST) {
          // Messages d'Admin (Mise à jour utilisateur)
          if (data.type === 'HELLO' || data.type === 'UPDATE_USER' || data.type === 'UPDATE') {
              if (data.user) {
                  // Mise à jour de la fiche du pair
                  this.peersMap[fromId] = { ...data.user, id: fromId };
                  
                  this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
                  
                  // CRITICAL: Rediffuser la liste complète à TOUS
                  this.broadcast({ type: 'SYNC_PEERS', peers: this.peersMap });
              }
          }
          // Relayer les autres types de messages (Ping, Chat, Logs)
          else if (['PING', 'PING_MOVE', 'PING_UPDATE', 'PING_DELETE', 'LOG_UPDATE'].includes(data.type)) {
              // L'hôte traite le message pour lui-même
              this.notify({ type: 'DATA_RECEIVED', data, from: fromId });
              
              // Puis le relaie à tout le monde SAUF l'émetteur
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
              // Autres données (Pings, Logs)
              this.notify({ type: 'DATA_RECEIVED', data, from: fromId });
          }
      }
  }

  // --- ENVOI DE DONNÉES ---

  // Envoi simple (Fire and Forget)
  public sendTo(targetId: string, data: any) {
      const conn = this.connections[targetId];
      if (conn && conn.open) {
          this.sendInternal(conn, data);
      }
  }

  // Envoi Sécurisé avec Retry (pour Pings importants)
  public async sendToWithAck(targetId: string, data: any): Promise<void> {
      const msgId = Math.random().toString(36).substr(2, 9);
      const payload = { ...data, _msgId: msgId, _needsAck: true };

      // On stocke le message pour le réessayer si pas de ACK
      this.pendingMessages.set(msgId, {
             id: msgId,
             data: { targetId, payload },
             timestamp: Date.now(),
             retryCount: 0,
             lastRetry: Date.now()
      });
      
      this.sendTo(targetId, payload);
      // On retourne une promesse résolue immédiatement pour ne pas bloquer l'UI
      return Promise.resolve();
  }

  // Broadcast Sécurisé (Utilisé pour les Pings Hostiles)
  public async broadcastWithAck(data: any): Promise<void> {
      if (this.role === OperatorRole.HOST) {
          Object.keys(this.connections).forEach(id => {
              this.sendToWithAck(id, data);
          });
      } else if (this.targetHostId) {
          this.sendToWithAck(this.targetHostId, data);
      }
  }

  // Broadcast Standard
  public broadcast(data: any) {
      if (this.role === OperatorRole.HOST) {
          Object.values(this.connections).forEach(conn => {
              if (conn.open) this.sendInternal(conn, data);
          });
      } else if (this.targetHostId) {
          this.sendTo(this.targetHostId, data);
      }
  }

  // Fonction interne d'envoi - PLUS DE COMPRESSION ICI pour éviter les bugs
  private sendInternal(conn: DataConnection, data: any) {
      try {
          conn.send(data);
      } catch (e) {
          console.error("Send failed", e);
      }
  }

  // --- SYSTÈME DE RETRY AUTOMATIQUE ---
  private startAckSystem() {
      if (this.ackCheckInterval) clearInterval(this.ackCheckInterval);
      this.ackCheckInterval = setInterval(() => {
          const now = Date.now();
          this.pendingMessages.forEach((pending, key) => {
              // Si le message est vieux de plus de ACK_TIMEOUT (2s)
              if (now - pending.lastRetry > ACK_TIMEOUT) {
                  if (pending.retryCount < MAX_RETRIES) {
                      // On réessaie
                      // console.log(`[Retry] Renvoi du message ${key} (${pending.retryCount + 1}/${MAX_RETRIES})`);
                      pending.retryCount++;
                      pending.lastRetry = now;
                      this.sendTo(pending.data.targetId, pending.data.payload);
                  } else {
                      // Abandon après 5 essais
                      console.warn(`[Fail] Message ${key} abandonné après ${MAX_RETRIES} essais`);
                      this.pendingMessages.delete(key);
                  }
              }
          });
      }, 1000); // Vérification chaque seconde
  }

  // --- API UTILISATEUR ---
  public updateUser(partialUser: Partial<UserData>) {
      if (!this.user) return;
      this.user = { ...this.user, ...partialUser };
      
      if (this.role === OperatorRole.HOST) {
          this.peersMap[this.user.id] = this.user;
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
          this.broadcast({ type: 'SYNC_PEERS', peers: this.peersMap });
      } else {
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

  // --- ROBUSTESSE RÉSEAU ---
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
