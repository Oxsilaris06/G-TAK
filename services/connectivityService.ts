/**
 * Service de Connectivité P2P
 * Gère les connexions PeerJS avec optimisation des performances
 */

import Peer from 'peerjs';
import { EventEmitter } from 'events';
import { UserData, OperatorRole } from '../types';
import { mmkvStorage } from './mmkvStorage';
import { CONFIG } from '../constants';

export type ConnectivityEvent =
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEERS_UPDATED'; peers: Record<string, UserData> }
  | { type: 'HOST_CONNECTED'; hostId: string }
  | { type: 'TOAST'; msg: string; level: string }
  | { type: 'DATA_RECEIVED'; data: any; from: string }
  | { type: 'DISCONNECTED'; reason: 'KICKED' | 'NO_HOST' | 'ERROR' }
  | { type: 'RECONNECTING'; attempt: number }
  | { type: 'NEW_HOST_PROMOTED'; hostId: string };

interface ConnectionState {
  peer: Peer | null;
  connections: Map<string, any>;
  userData: UserData | null;
  role: OperatorRole;
  hostId: string;
  isReconnecting: boolean;
  reconnectAttempt: number;
}

class ConnectivityEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }
}

const eventEmitter = new ConnectivityEventEmitter();

class ConnectivityService {
  private state: ConnectionState = {
    peer: null,
    connections: new Map(),
    userData: null,
    role: OperatorRole.OPR,
    hostId: '',
    isReconnecting: false,
    reconnectAttempt: 0,
  };

  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 10000;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  /**
   * Initialise la connexion PeerJS
   */
  /**
   * Génère un ID court (6 caractères alphanumériques majuscules)
   */
  private generateShortId(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Initialise la connexion PeerJS
   */
  async init(
    userData: UserData,
    role: OperatorRole,
    hostId?: string
  ): Promise<void> {
    // Cleanup existant
    this.cleanup();

    this.state.userData = userData;
    this.state.role = role;
    this.state.hostId = hostId || '';

    // Récupération de l'ID persistant ou génération d'un nouveau
    let storedId = mmkvStorage.getString(CONFIG.SESSION_STORAGE_KEY);

    // Si pas d'ID stocké, on en génère un court tout de suite
    if (!storedId) {
      storedId = this.generateShortId();
    }

    console.log('[Connectivity] Using ID:', storedId);

    return new Promise((resolve, reject) => {
      try {
        // Créer le peer avec l'ID court
        this.state.peer = new Peer(storedId, CONFIG.PEER_CONFIG);

        this.state.peer.on('open', (id) => {
          console.log('[Connectivity] Peer opened:', id);
          this.state.userData!.id = id;

          // Sauvegarde de l'ID pour la prochaine fois
          if (id !== storedId) {
            console.log('[Connectivity] Saving new persistent ID');
            mmkvStorage.set(CONFIG.SESSION_STORAGE_KEY, id);
          }

          if (role === OperatorRole.HOST) {
            this.state.hostId = id;
          }

          this.emit({ type: 'PEER_OPEN', id });

          // Connexion à l'hôte si client
          if (role === OperatorRole.OPR && hostId) {
            this.connectToHost(hostId);
          }

          this.startHeartbeat();
          resolve();
        });

        this.state.peer.on('connection', (conn) => {
          this.handleIncomingConnection(conn);
        });

        this.state.peer.on('error', (err: any) => {
          console.error('[Connectivity] Peer error:', err);

          // Gestion du cas où l'ID est déjà pris (unavailable-id)
          if (err.type === 'unavailable-id') {
            console.log('[Connectivity] ID unavailable, generating new one...');
            // L'ID est pris, on doit en générer un nouveau
            mmkvStorage.delete(CONFIG.SESSION_STORAGE_KEY);

            // Nettoyage propre sans déclencher de reconnexion
            this.cleanup();

            // Récursion avec un nouvel ID généré
            this.init(userData, role, hostId).then(resolve).catch(reject);
            return;
          }

          this.handleError(err);
          // Ne pas reject ici si on a géré l'erreur unavailable-id par une reconnexion
          if (err.type !== 'unavailable-id') reject(err);
        });

        this.state.peer.on('disconnected', () => {
          console.log('[Connectivity] Peer disconnected');
          this.handleDisconnect();
        });
      } catch (e) {
        console.error('[Connectivity] Init error:', e);
        reject(e);
      }
    });
  }

  /**
   * Connecte à l'hôte
   */
  private connectToHost(hostId: string): void {
    if (!this.state.peer) return;

    console.log('[Connectivity] Connecting to host:', hostId);
    const conn = this.state.peer.connect(hostId, {
      reliable: true,
      serialization: 'json',
    });

    conn.on('open', () => {
      console.log('[Connectivity] Connected to host');
      this.state.connections.set(hostId, conn);
      this.state.hostId = hostId;
      this.emit({ type: 'HOST_CONNECTED', hostId });

      // Envoyer HELLO
      this.sendTo(hostId, {
        type: 'HELLO',
        user: this.state.userData,
      });
    });

    conn.on('data', (data) => {
      this.handleData(data, hostId);
    });

    conn.on('close', () => {
      console.log('[Connectivity] Host connection closed');
      this.state.connections.delete(hostId);
      this.emit({ type: 'DISCONNECTED', reason: 'NO_HOST' });
    });

    conn.on('error', (err) => {
      console.error('[Connectivity] Host connection error:', err);
    });
  }

  /**
   * Gère une connexion entrante (host uniquement)
   */
  private handleIncomingConnection(conn: any): void {
    console.log('[Connectivity] Incoming connection from:', conn.peer);

    conn.on('open', () => {
      this.state.connections.set(conn.peer, conn);
      this.broadcastPeerList();
    });

    conn.on('data', (data: any) => {
      this.handleData(data, conn.peer);
    });

    conn.on('close', () => {
      console.log('[Connectivity] Connection closed:', conn.peer);
      this.state.connections.delete(conn.peer);
      this.broadcastPeerList();
    });

    conn.on('error', (err: any) => {
      console.error('[Connectivity] Connection error:', conn.peer, err);
    });
  }

  /**
   * Gère les données reçues
   */
  private handleData(data: any, from: string): void {
    if (!data || typeof data !== 'object') return;

    // Propager l'événement
    this.emit({ type: 'DATA_RECEIVED', data, from });

    // Gestion spéciale pour l'hôte
    if (this.state.role === OperatorRole.HOST) {
      this.handleHostData(data, from);
    }
  }

  /**
   * Gestion des données côté hôte (relaying)
   */
  private handleHostData(data: any, from: string): void {
    switch (data.type) {
      case 'HELLO':
        // Nouveau client connecté, broadcaster la liste
        this.broadcastPeerList();
        break;

      case 'UPDATE_USER':
      case 'UPDATE':
        // Propager la mise à jour à tous les autres
        this.broadcastExcept(from, data);
        break;

      case 'PING':
        // Propager le ping à tous
        this.broadcast(data);
        break;

      case 'LOG_UPDATE':
        // Propager les logs
        this.broadcast(data);
        break;

      case 'PING_MOVE':
      case 'PING_DELETE':
      case 'PING_UPDATE':
        // Propager les modifications de pings
        this.broadcast(data);
        break;

      case 'CLIENT_LEAVING':
        // Client qui quitte proprement
        this.state.connections.delete(from);
        this.broadcastPeerList();
        break;
    }
  }

  /**
   * Diffuse la liste des peers à tous
   */
  private broadcastPeerList(): void {
    const peers: Record<string, UserData> = {};

    // Ajouter l'hôte
    if (this.state.userData) {
      peers[this.state.userData.id] = this.state.userData;
    }

    // Collecter les données des peers connectés
    this.state.connections.forEach((_, peerId) => {
      // Les données sont stockées lors des HELLO/UPDATE
    });

    this.broadcast({
      type: 'PEERS_UPDATED',
      peers,
    });
  }

  /**
   * Envoie des données à un peer spécifique
   */
  sendTo(peerId: string, data: any): boolean {
    const conn = this.state.connections.get(peerId);
    if (conn && conn.open) {
      try {
        conn.send(data);
        return true;
      } catch (e) {
        console.error('[Connectivity] Send error:', e);
        return false;
      }
    }
    return false;
  }

  /**
   * Diffuse des données à tous les peers
   */
  broadcast(data: any): void {
    this.state.connections.forEach((conn) => {
      if (conn.open) {
        try {
          conn.send(data);
        } catch (e) {
          console.error('[Connectivity] Broadcast error:', e);
        }
      }
    });
  }

  /**
   * Diffuse à tous sauf un peer
   */
  broadcastExcept(exceptPeerId: string, data: any): void {
    this.state.connections.forEach((conn, peerId) => {
      if (peerId !== exceptPeerId && conn.open) {
        try {
          conn.send(data);
        } catch (e) {
          console.error('[Connectivity] Broadcast error:', e);
        }
      }
    });
  }

  /**
   * Diffuse avec accusé de réception
   */
  async broadcastWithAck(data: any, timeout = 5000): Promise<void> {
    const promises: Promise<void>[] = [];

    this.state.connections.forEach((conn, peerId) => {
      if (conn.open) {
        promises.push(
          new Promise((resolve, reject) => {
            const ackTimeout = setTimeout(() => {
              reject(new Error(`ACK timeout from ${peerId}`));
            }, timeout);

            const ackHandler = (response: any) => {
              if (response.type === 'ACK' && response.ackId === data.id) {
                clearTimeout(ackTimeout);
                conn.off('data', ackHandler);
                resolve();
              }
            };

            conn.on('data', ackHandler);
            conn.send(data);
          })
        );
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Met à jour les données utilisateur et broadcast
   */
  updateUser(updates: Partial<UserData>): void {
    if (this.state.userData) {
      this.state.userData = { ...this.state.userData, ...updates };
      this.broadcast({
        type: 'UPDATE_USER',
        user: this.state.userData,
      });
    }
  }

  /**
   * Met à jour la position et broadcast
   */
  updateUserPosition(lat: number, lng: number, head?: number): void {
    if (this.state.userData) {
      this.state.userData.lat = lat;
      this.state.userData.lng = lng;
      if (head !== undefined) {
        this.state.userData.head = head;
      }
      this.broadcast({
        type: 'UPDATE',
        user: this.state.userData,
      });
    }
  }

  /**
   * Exclut un utilisateur (host uniquement)
   */
  kickUser(peerId: string): void {
    this.sendTo(peerId, { type: 'KICKED' });
    const conn = this.state.connections.get(peerId);
    if (conn) {
      conn.close();
      this.state.connections.delete(peerId);
      this.broadcastPeerList();
    }
  }

  /**
   * Gère les erreurs de connexion
   */
  private handleError(error: any): void {
    this.emit({
      type: 'TOAST',
      msg: `Erreur réseau: ${error.message || 'Inconnue'}`,
      level: 'error',
    });

    // Tentative de reconnexion si pertinent
    if (error.type === 'network' || error.type === 'disconnected') {
      this.attemptReconnect();
    }
  }

  /**
   * Gère la déconnexion
   */
  private handleDisconnect(): void {
    this.attemptReconnect();
  }

  /**
   * Tente de se reconnecter
   */
  private attemptReconnect(): void {
    if (
      this.state.isReconnecting ||
      this.state.reconnectAttempt >= this.MAX_RECONNECT_ATTEMPTS
    ) {
      this.emit({
        type: 'DISCONNECTED',
        reason: 'ERROR',
      });
      return;
    }

    this.state.isReconnecting = true;
    this.state.reconnectAttempt++;

    this.emit({
      type: 'RECONNECTING',
      attempt: this.state.reconnectAttempt,
    });

    const delay = Math.min(1000 * Math.pow(2, this.state.reconnectAttempt), 30000);

    this.reconnectTimeout = setTimeout(() => {
      if (this.state.userData && this.state.role) {
        this.init(this.state.userData, this.state.role, this.state.hostId || undefined)
          .then(() => {
            this.state.isReconnecting = false;
            this.state.reconnectAttempt = 0;
          })
          .catch(() => {
            this.state.isReconnecting = false;
            this.attemptReconnect();
          });
      }
    }, delay);
  }

  /**
   * Démarre le heartbeat
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({ type: 'HEARTBEAT', timestamp: Date.now() });
    }, this.HEARTBEAT_INTERVAL);
  }

  /**
   * Arrête le heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Gère le changement d'état de l'app
   */
  handleAppStateChange(state: 'active' | 'background'): void {
    if (state === 'active') {
      // Vérifier la connexion
      if (this.state.peer && this.state.peer.disconnected) {
        this.attemptReconnect();
      }
    }
  }

  /**
   * S'abonne aux événements
   */
  subscribe(callback: (event: ConnectivityEvent) => void): () => void {
    eventEmitter.on('event', callback);
    return () => {
      eventEmitter.off('event', callback);
    };
  }

  /**
   * Émet un événement
   */
  private emit(event: ConnectivityEvent): void {
    eventEmitter.emit('event', event);
  }

  /**
   * Nettoie toutes les connexions
   */
  cleanup(): void {
    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.state.connections.forEach((conn) => {
      if (conn.open) {
        conn.close();
      }
    });
    this.state.connections.clear();

    if (this.state.peer) {
      // IMPORTANT: Enlever les listeners pour éviter que destroy() déclenche 'disconnected'
      // Ce qui provoquerait une boucle infinie de reconnexions
      this.state.peer.removeAllListeners();
      this.state.peer.destroy();
      this.state.peer = null;
    }

    this.state.isReconnecting = false;
    this.state.reconnectAttempt = 0;
  }
}

export const connectivityService = new ConnectivityService();
export default connectivityService;
