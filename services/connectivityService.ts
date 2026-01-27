import Peer, { DataConnection } from 'peerjs';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage'; // AJOUT CRITIQUE
import { CONFIG } from '../constants';
import { UserData, OperatorRole, OperatorStatus } from '../types';
import { AppStateStatus } from 'react-native';

// CLÉ DE STOCKAGE POUR L'IDENTITÉ PERSISTANTE
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

const RECONNECT_INTERVAL = 3000;
const HEALTH_CHECK_INTERVAL = 10000;
const PEER_CREATION_TIMEOUT = 10000;

class ConnectivityService {
  private peer: Peer | null = null;
  private connections: Record<string, DataConnection> = {}; // { peerId: conn }
  private listeners: Listener[] = [];
  
  private user: UserData | null = null;
  private role: OperatorRole = OperatorRole.OPR;
  private targetHostId: string = '';
  
  // États internes
  private isConnecting = false;
  private isDestroyed = false;
  private reconnectAttempts = 0;
  
  // Timers
  private retryTimeout: any;
  private healthCheckInterval: any;
  private networkSwitchTimeout: any;
  private creationTimeout: any;
  
  // Gestion Réseau
  private netInfoUnsubscribe: (() => void) | null = null;
  private lastNetworkType: string | null = null;

  // --- GESTION DE L'IDENTITÉ PERSISTANTE (MILSPEC) ---
  
  // Récupère ou génère un ID unique qui ne changera JAMAIS pour cet appareil
  private async getPersistentId(): Promise<string> {
      try {
          const savedId = await AsyncStorage.getItem(STORAGE_KEY_ID);
          if (savedId) {
              console.log(`[Identity] ID Persistant récupéré: ${savedId}`);
              return savedId;
          }
          // Génération d'un nouvel ID (une seule fois dans la vie de l'app)
          const newId = this.generateShortId();
          await AsyncStorage.setItem(STORAGE_KEY_ID, newId);
          console.log(`[Identity] Nouvel ID Persistant généré: ${newId}`);
          return newId;
      } catch (error) {
          console.error("[Identity] Erreur stockage ID, utilisation ID temporaire", error);
          return this.generateShortId();
      }
  }

  private generateShortId(): string {
      return Math.random().toString(36).substr(2, 9).toUpperCase();
  }

  // --- INITIALISATION ---

  public async init(user: UserData, role: OperatorRole, targetHostId: string = '') {
      if (this.isConnecting) return;
      this.cleanup(false); // Nettoyage léger (garde les listeners)
      
      this.isDestroyed = false;
      this.isConnecting = true;
      
      // Force l'ID persistant
      const persistentId = await this.getPersistentId();
      
      this.user = { ...user, id: persistentId };
      this.role = role;
      this.targetHostId = targetHostId;

      this.setupNetworkMonitor();
      this.connectToPeerServer(persistentId);
      this.startHealthCheck();
  }

  private connectToPeerServer(forceId: string) {
      if (this.peer) { this.peer.destroy(); }

      console.log(`[Conn] Tentative connexion PeerJS avec ID: ${forceId}`);

      try {
          // On force l'ID spécifique. Si le serveur dit "ID Taken", c'est que notre 
          // session précédente est zombie. PeerJS standard throw une erreur pour ça.
          this.peer = new Peer(forceId, CONFIG.PEER_CONFIG);

          // Timer de sécurité si PeerJS ne répond pas (UDP bloqué, pare-feu)
          this.creationTimeout = setTimeout(() => {
              if (this.peer && !this.peer.open) {
                  console.warn("[Conn] Timeout création Peer - Relance");
                  this.handleConnectionError(new Error("Timeout Creation"));
              }
          }, PEER_CREATION_TIMEOUT);

          this.peer.on('open', (id) => {
              clearTimeout(this.creationTimeout);
              this.isConnecting = false;
              this.reconnectAttempts = 0;
              console.log(`[Conn] Peer Ouvert: ${id}`);
              
              // Notification critique : C'est ici que l'ID est confirmé
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
              console.error(`[Conn] Erreur Peer: ${err.type}`, err);
              
              // Gestion spécifique "ID Taken" (Session Zombie)
              if (err.type === 'unavailable-id') {
                  console.warn("[Conn] ID déjà pris (Zombie). Tentative de récupération...");
                  // On attend un peu que le serveur nettoie l'ancien socket et on réessaie
                  // C'est CRUCIAL pour la persistance de l'ID unique
                  setTimeout(() => this.connectToPeerServer(forceId), 2000);
              } else if (err.type === 'peer-unavailable') {
                  // Hôte introuvable
                  this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
              } else {
                  this.handleConnectionError(err);
              }
          });

          this.peer.on('disconnected', () => {
              console.warn("[Conn] Peer déconnecté (mais instance active)");
              // PeerJS permet la reconnexion sans tout détruire
              if (!this.isDestroyed && this.peer) {
                  this.peer.reconnect();
              }
          });

          this.peer.on('close', () => {
              console.warn("[Conn] Peer fermé (Instance détruite)");
              if (!this.isDestroyed) this.handleConnectionError(new Error("Peer Closed"));
          });

      } catch (e) {
          this.handleConnectionError(e);
      }
  }

  // --- GESTION DE LA CONNEXION HÔTE ---

  private connectToHost(hostId: string) {
      if (!this.peer || this.peer.destroyed) return;
      
      console.log(`[Link] Connexion vers Hôte: ${hostId}`);
      
      try {
          const conn = this.peer.connect(hostId, {
              reliable: true,
              metadata: { 
                  user: this.user, // Envoi immédiat de l'identité
                  version: '2.0-MILSPEC' 
              }
          });
          
          this.setupConnectionEvents(conn, true);
      } catch (e) {
          console.error("[Link] Echec connexion hôte", e);
      }
  }

  private handleIncomingConnection(conn: DataConnection) {
      console.log(`[Link] Connexion entrante de: ${conn.peer}`);
      
      // Sécurité : Si je suis OPR, je n'accepte que l'Hôte
      if (this.role === OperatorRole.OPR && conn.peer !== this.targetHostId) {
          console.warn(`[Secu] Rejet connexion non-hôte de ${conn.peer}`);
          conn.close();
          return;
      }
      
      this.setupConnectionEvents(conn, false);
  }

  private setupConnectionEvents(conn: DataConnection, isOutgoingToHost: boolean) {
      conn.on('open', () => {
          console.log(`[Link] Tunnel établi avec ${conn.peer}`);
          this.connections[conn.peer] = conn;
          
          if (isOutgoingToHost) {
              this.notify({ type: 'HOST_CONNECTED', hostId: conn.peer });
              // Handshake immédiat
              this.sendTo(conn.peer, { type: 'HELLO', user: this.user });
          }
      });

      conn.on('data', (data: any) => {
          this.handleDataMessage(data, conn.peer);
      });

      conn.on('close', () => {
          console.log(`[Link] Tunnel fermé avec ${conn.peer}`);
          delete this.connections[conn.peer];
          
          if (isOutgoingToHost && !this.isDestroyed) {
              this.notify({ type: 'DISCONNECTED', reason: 'NETWORK_ERROR' });
              // Tentative de reconnexion agressive
              this.scheduleReconnect(); 
          }
      });
      
      conn.on('error', (e) => {
          console.error(`[Link] Erreur tunnel ${conn.peer}`, e);
          conn.close();
      });
  }

  private handleDataMessage(data: any, fromId: string) {
      // Routage interne des messages système
      if (data.type === 'KICK') {
          this.cleanup(true);
          this.notify({ type: 'DISCONNECTED', reason: 'KICKED' });
          return;
      }
      
      // Transmission à l'UI
      this.notify({ type: 'DATA_RECEIVED', data, from: fromId });
      
      // Gestion spécifique mise à jour de liste (Déduplication amont)
      if (data.type === 'SYNC_PEERS' || data.type === 'PEERS_UPDATED') {
          this.notify({ type: 'PEERS_UPDATED', peers: data.peers });
      }
  }

  // --- ROBUSTESSE RÉSEAU (MILSPEC) ---

  private setupNetworkMonitor() {
      if (this.netInfoUnsubscribe) this.netInfoUnsubscribe();
      
      this.netInfoUnsubscribe = NetInfo.addEventListener(state => {
          const currentType = state.type;
          
          // Détection changement interface (ex: Wifi -> Cellular)
          if (this.lastNetworkType && this.lastNetworkType !== currentType && state.isConnected) {
              console.log(`[Net] Changement interface détecté: ${this.lastNetworkType} -> ${currentType}`);
              // PeerJS n'aime pas les changements d'IP. On force le refresh.
              // On attend 1s pour que l'IP soit stable
              if (this.networkSwitchTimeout) clearTimeout(this.networkSwitchTimeout);
              this.networkSwitchTimeout = setTimeout(() => {
                  this.refreshConnection();
              }, 1000);
          }
          this.lastNetworkType = currentType;
      });
  }
  
  // Fonction critique pour le switch 4G/Wifi
  public refreshConnection() {
      console.log("[Net] Refresh Force de la connexion...");
      if (this.peer) {
          // On déconnecte du serveur de signalement mais on garde l'objet
          this.peer.disconnect();
          setTimeout(() => {
              if (this.peer && !this.peer.destroyed) {
                  this.peer.reconnect();
              }
          }, 500);
      }
  }

  private handleConnectionError(error: any) {
      if (this.isDestroyed) return;
      console.log(`[Conn] Erreur critique, tentative reconnexion dans ${RECONNECT_INTERVAL}ms`);
      this.scheduleReconnect();
  }

  private scheduleReconnect() {
      if (this.retryTimeout) clearTimeout(this.retryTimeout);
      this.retryTimeout = setTimeout(() => {
          if (!this.isDestroyed && this.user) {
              this.reconnectAttempts++;
              this.notify({ type: 'RECONNECTING', attempt: this.reconnectAttempts });
              // On relance tout l'init avec l'ID persistant
              this.connectToPeerServer(this.user.id); 
          }
      }, RECONNECT_INTERVAL);
  }

  // --- API PUBLIQUE ---

  public sendTo(targetId: string, data: any) {
      const conn = this.connections[targetId];
      if (conn && conn.open) {
          conn.send(data);
      }
  }

  public broadcast(data: any) {
      Object.values(this.connections).forEach(conn => {
          if (conn.open) conn.send(data);
      });
  }

  public updateUser(partialUser: Partial<UserData>) {
      if (!this.user) return;
      this.user = { ...this.user, ...partialUser };
      // Broadcast la mise à jour aux pairs connectés
      this.broadcast({ type: 'UPDATE_USER', user: this.user });
  }
  
  public updateUserPosition(lat: number, lng: number, head: number) {
      if (!this.user) return;
      this.user = { ...this.user, lat, lng, head };
      // Optimisation: On n'envoie la position que si connecté
      this.broadcast({ type: 'UPDATE', user: { id: this.user.id, lat, lng, head, callsign: this.user.callsign, status: this.user.status } });
  }

  public kickUser(targetId: string) {
      if (this.role !== OperatorRole.HOST) return;
      this.sendTo(targetId, { type: 'KICK' });
      // On laisse le temps au message de partir
      setTimeout(() => {
          const conn = this.connections[targetId];
          if(conn) conn.close();
      }, 500);
  }

  // --- GESTION APP STATE ---
  
  public handleAppStateChange(status: AppStateStatus) {
      if (status === 'active') {
          // Au retour au premier plan, on vérifie si tout est vivant
          if (this.peer && this.peer.disconnected) {
              this.peer.reconnect();
          }
      }
  }

  private startHealthCheck() {
      if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = setInterval(() => {
          if (this.isDestroyed) return;
          
          // Vérification Socket PeerJS
          if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
              console.log("[Health] Peer déconnecté détecté, reconnexion...");
              this.peer.reconnect();
          }
          
          // Si je suis OPR et que je n'ai pas de connexion active vers l'hôte
          if (this.role === OperatorRole.OPR && this.targetHostId) {
             const hostConn = this.connections[this.targetHostId];
             if (!hostConn || !hostConn.open) {
                 console.log("[Health] Lien Hôte mort, relance...");
                 this.connectToHost(this.targetHostId);
             }
          }
      }, HEALTH_CHECK_INTERVAL);
  }

  public cleanup(full = true) {
      this.isDestroyed = full;
      this.isConnecting = false;
      
      if (this.retryTimeout) clearTimeout(this.retryTimeout);
      if (this.creationTimeout) clearTimeout(this.creationTimeout);
      if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
      if (this.networkSwitchTimeout) clearTimeout(this.networkSwitchTimeout);
      
      if (full && this.netInfoUnsubscribe) {
          this.netInfoUnsubscribe();
          this.netInfoUnsubscribe = null;
      }
      
      Object.values(this.connections).forEach(c => c.close());
      this.connections = {};
      
      if (this.peer) {
          this.peer.destroy();
          this.peer = null;
      }
  }

  // --- SUBSCRIPTION ---
  public subscribe(listener: Listener) {
      this.listeners.push(listener);
      return () => {
          this.listeners = this.listeners.filter(l => l !== listener);
      };
  }

  private notify(event: ConnectivityEvent) {
      this.listeners.forEach(l => l(event));
  }
}

export const connectivityService = new ConnectivityService();
