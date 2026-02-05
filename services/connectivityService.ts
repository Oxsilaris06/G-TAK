/**
 * Service de Connectivité P2P
 * Gère les connexions PeerJS avec optimisation des performances
 */

import Peer from 'peerjs';
import { EventEmitter } from 'events';
import { UserData, OperatorRole } from '../types';
import { mmkvStorage } from './mmkvStorage';
import { CONFIG } from '../constants';
import { imageService } from './imageService';

export type ConnectivityEvent =
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEERS_UPDATED'; peers: Record<string, UserData> }
  | { type: 'HOST_CONNECTED'; hostId: string }
  | { type: 'TOAST'; msg: string; level: string }
  | { type: 'DATA_RECEIVED'; data: any; from: string }
  | { type: 'DISCONNECTED'; reason: 'KICKED' | 'NO_HOST' | 'ERROR' }
  | { type: 'RECONNECTING'; attempt: number }
  | { type: 'NEW_HOST_PROMOTED'; hostId: string }
  | { type: 'IMAGE_READY'; imageId: string; uri: string };

interface ConnectionState {
  peer: Peer | null;
  connections: Map<string, any>;
  peerData: Map<string, UserData>;
  userData: UserData | null;
  role: OperatorRole;
  hostId: string;
  isReconnecting: boolean;
  reconnectAttempt: number;
  tempChunks: Map<string, { total: number; chk: string[] }>;
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
    peerData: new Map(),
    userData: null,
    role: OperatorRole.OPR,
    hostId: '',
    isReconnecting: false,
    reconnectAttempt: 0,
    tempChunks: new Map(),
  };

  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 10000;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  /**
   * Génère un ID simplifié et lisible (6 caractères)
   */
  private generateSimplifiedId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclut I, O, 1, 0 pour éviter confusion
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
    // 1. Récupération de l'ID persistant
    let storedId = mmkvStorage.getString(CONFIG.SESSION_STORAGE_KEY);

    // MIGRATION: Si l'ID est un UUID (long), on force la regénération vers un ID court
    if (storedId && storedId.length > 10) {
      console.log('[Connectivity] Migrating legacy UUID to Simplified ID');
      storedId = undefined; // Force la régénération
    }

    // STRICTEMENT Persistant : Si pas d'ID, on en crée un et on le garde A VIE.
    if (!storedId) {
      storedId = this.generateSimplifiedId();
      mmkvStorage.set(CONFIG.SESSION_STORAGE_KEY, storedId);
      console.log('[Connectivity] Created NEW Persistent Short ID:', storedId);
    } else {
      console.log('[Connectivity] Loaded Persistent Short ID:', storedId);
    }

    // 2. Vérifier si on peut réutiliser la connexion existante
    if (this.state.peer && !this.state.peer.disconnected && !this.state.peer.destroyed) {
      if (this.state.userData?.id === storedId) {
        console.log('[Connectivity] Reusing existing Peer connection:', storedId);
        this.state.userData = { ...userData, id: storedId };
        this.state.role = role;
        this.state.hostId = hostId || '';

        // Si on passe en mode OPR et qu'on a un host, on se connecte
        if (role === OperatorRole.OPR && hostId && !this.state.connections.has(hostId)) {
          this.connectToHost(hostId);
        }
        // Si on a déjà une connexion Host mais qu'on change d'Host (rare), on gère
        if (role === OperatorRole.OPR && hostId && this.state.connections.has(hostId)) {
          // Déjà connecté, on update juste le profil
          this.updateUser(userData);
        }

        return Promise.resolve();
      }
    }

    // 3. Sinon, nettoyage complet et nouvelle connexion
    this.cleanup();

    this.state.userData = userData;
    this.state.role = role;
    this.state.hostId = hostId || '';

    return new Promise((resolve, reject) => {
      try {
        // Créer le peer avec l'ID persistant
        // NOTE: Si l'ID est déjà pris sur le serveur (zombie), PeerJS renverra 'unavailable-id'
        this.state.peer = new Peer(storedId, CONFIG.PEER_CONFIG);

        this.state.peer.on('open', (id) => {
          console.log('[Connectivity] Peer opened:', id);
          this.state.userData!.id = id;

          // Si l'ID a changé (ce qui ne devrait pas arriver avec un UUID sauf collision cosmique)
          if (id !== storedId) {
            console.warn('[Connectivity] ID changed by server (unexpected):', id);
            mmkvStorage.set(CONFIG.SESSION_STORAGE_KEY, id);
          }

          if (role === OperatorRole.HOST) {
            this.state.hostId = id;
          }

          this.emit({ type: 'PEER_OPEN', id });

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

          if (err.type === 'unavailable-id') {
            console.log('[Connectivity] ID unavailable. Retrying with new ID...');
            mmkvStorage.delete(CONFIG.SESSION_STORAGE_KEY);
            this.cleanup();
            // Retry avec un nouvel ID généré au prochain tour
            this.init(userData, role, hostId).then(resolve).catch(reject);
            return;
          }

          this.handleError(err);
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
      // NOTE: Ne pas broadcaster ici - on attend le HELLO pour déduplication
      // Le broadcast se fera après traitement du HELLO (ligne 430)
    });

    conn.on('data', (data: any) => {
      this.handleData(data, conn.peer);
    });

    conn.on('close', () => {
      console.log('[Connectivity] Connection closed:', conn.peer);
      this.state.connections.delete(conn.peer);

      // Nettoyer les données utilisateur associées à cette connexion
      let userIdToRemove: string | null = null;
      this.state.peerData.forEach((userData: any, userId) => {
        if (userData._networkId === conn.peer) {
          userIdToRemove = userId;
        }
      });

      if (userIdToRemove) {
        console.log('[Connectivity] Removing user data for closed connection:', userIdToRemove);
        this.state.peerData.delete(userIdToRemove);
      }

      this.broadcastPeerList();
    });

    conn.on('error', (err: any) => {
      console.error('[Connectivity] Connection error:', conn.peer, err);
    });
  }

  /**
   * Request an image from a peer
   */
  requestImage(imageId: string, targetIds: string[]): void {
    const msg = { type: 'REQUEST_IMAGE', imageId, from: this.state.userData?.id };
    targetIds.forEach(id => {
      if (id === this.state.hostId || this.state.connections.has(id)) {
        this.sendTo(id, msg);
      }
    });
  }

  /**
   * Send an image to a peer (Found in local storage)
   */
  async sendImage(targetId: string, imageId: string): Promise<void> {
    try {
      if (!await imageService.exists(imageId)) {
        console.warn('[Connectivity] Requested image not found locally:', imageId);
        Alert.alert("DEBUG P2P", "Host: Image demandée INTROUVABLE locally\nID: " + imageId);
        return;
      }

      const base64 = await imageService.readAsBase64(imageId);
      const CHUNK_SIZE = 4 * 1024; // 4KB (Smaller chunks for better reliability)
      const totalChunks = Math.ceil(base64.length / CHUNK_SIZE);

      console.log(`[Connectivity] Sending image ${imageId} to ${targetId} (${totalChunks} chunks)`);

      const sentStart = this.sendTo(targetId, { type: 'IMAGE_START', imageId, total: totalChunks });
      if (!sentStart) {
        console.warn(`[Connectivity] Failed to send IMAGE_START to ${targetId}`);
        return;
      }

      // Send chunks with slight delay to avoid congestion
      let offset = 0;
      for (let i = 0; i < totalChunks; i++) {
        const chunk = base64.slice(offset, offset + CHUNK_SIZE);
        offset += CHUNK_SIZE;

        this.sendTo(targetId, {
          type: 'IMAGE_CHUNK',
          imageId,
          index: i,
          data: chunk
        });

        // SLOW DOWN: 20ms wait per chunk to ensure UDP/WebRTC buffers don't overflow
        await new Promise(r => setTimeout(r, 20));
      }

    } catch (e) {
      console.error('[Connectivity] Error sending image:', e);
    }
  }

  /**
   * Gère les données reçues
   */
  private handleData(data: any, from: string): void {
    if (!data || typeof data !== 'object') return;

    // --- IMAGE PROTOCOL HANDLERS ---
    if (data.type === 'REQUEST_IMAGE') {
      if (data.imageId) {
        this.sendImage(from, data.imageId);
      }
      return;
    }

    if (data.type === 'IMAGE_START') {
      let pending = this.state.tempChunks.get(data.imageId);
      if (!pending) {
        pending = { total: data.total, chk: [] };
        this.state.tempChunks.set(data.imageId, pending);
      } else {
        pending.total = data.total; // Update total if we only had chunks before
      }

      console.log(`[Connectivity] Receiving image ${data.imageId} (${data.total} chunks)`);

      // Check completeness immediately in case chunks arrived first
      this.checkImageCompletion(data.imageId);
      return;
    }

    if (data.type === 'IMAGE_CHUNK') {
      let pending = this.state.tempChunks.get(data.imageId);
      if (!pending) {
        // Orphan chunk (arrived before header), buffer it
        pending = { total: 0, chk: [] };
        this.state.tempChunks.set(data.imageId, pending);
        console.log(`[Connectivity] Buffering early chunk ${data.index} for ${data.imageId}`);
      }

      pending.chk[data.index] = data.data;

      if (pending.total > 0) {
        this.checkImageCompletion(data.imageId);
      }
      return;
    }
    // -------------------------------

    // Propager l'événement
    this.emit({ type: 'DATA_RECEIVED', data, from });

    // Gestion spéciale pour l'hôte
    if (this.state.role === OperatorRole.HOST) {
      this.handleHostData(data, from);
    }
  }

  private checkImageCompletion(imageId: string) {
    const pending = this.state.tempChunks.get(imageId);
    if (!pending || pending.total === 0) return;

    let receivedCount = 0;
    for (let i = 0; i < pending.total; i++) {
      if (pending.chk[i]) receivedCount++;
    }

    if (receivedCount === pending.total) { // All chunks received
      const fullBase64 = pending.chk.join('');
      this.state.tempChunks.delete(imageId);
      imageService.writeBase64(imageId, fullBase64).then((uri) => {
        console.log('[Connectivity] Image Received & Saved:', uri);
        this.emit({ type: 'IMAGE_READY', imageId, uri });
      });
    }
  }

  /**
   * Gestion des données côté hôte (relaying)
   */
  private handleHostData(data: any, from: string): void {
    switch (data.type) {
      case 'HELLO':
        // Nouveau client connecté, on stocke ses données
        if (data.user && data.user.id) {
          let storageId = data.user.id;

          // PROTECTION: Si collision avec l'ID de l'Host, on suffixe
          if (this.state.userData && data.user.id === this.state.userData.id) {
            console.warn('[Connectivity] ID Collision with Host. Suffixing client:', from);
            storageId = data.user.id + '_DUP';
          }

          // DEDUPLICATION AVANCÉE: Vérifier par ID ET par callsign
          let existingUser = this.state.peerData.get(storageId);
          let existingUserId = storageId;

          // Si pas trouvé par ID, chercher par callsign (trigramme)
          if (!existingUser && data.user.callsign) {
            this.state.peerData.forEach((userData: any, userId) => {
              if (userData.callsign === data.user.callsign && userId !== this.state.userData?.id) {
                existingUser = userData;
                existingUserId = userId;
                console.log('[Connectivity] Found existing user by callsign:', data.user.callsign, 'userId:', userId);
              }
            });
          }

          if (existingUser) {
            // Reconnexion détectée - mettre à jour le network ID
            console.log('[Connectivity] Reconnection detected for', existingUserId, 'old networkId:', existingUser._networkId, 'new:', from);

            // Nettoyer l'ancienne connexion si elle existe encore
            const oldNetworkId = existingUser._networkId;
            if (oldNetworkId && oldNetworkId !== from && this.state.connections.has(oldNetworkId)) {
              console.log('[Connectivity] Closing stale connection:', oldNetworkId);
              const oldConn = this.state.connections.get(oldNetworkId);
              if (oldConn) oldConn.close();
              this.state.connections.delete(oldNetworkId);
            }

            // Si l'ID a changé (trouvé par callsign), supprimer l'ancienne entrée
            if (existingUserId !== storageId) {
              console.log('[Connectivity] User ID changed from', existingUserId, 'to', storageId, '- merging data');
              this.state.peerData.delete(existingUserId);
            }

            // Mettre à jour avec les nouvelles données et le nouveau network ID
            // On fusionne les données existantes avec les nouvelles
            const updatedUser = {
              ...existingUser,  // Garder les données existantes
              ...data.user,     // Écraser avec les nouvelles données
              id: storageId,    // Utiliser le nouvel ID
              _networkId: from  // Nouveau network ID
            };
            this.state.peerData.set(storageId, updatedUser);
          } else {
            // Nouveau client
            const userWithNetId = { ...data.user, id: storageId, _networkId: from };
            this.state.peerData.set(storageId, userWithNetId);
            console.log('[Connectivity] New client connected:', from, storageId, 'callsign:', data.user.callsign);
          }
        }
        this.broadcastPeerList();
        break;

      case 'UPDATE_USER':
      case 'UPDATE':
        if (data.user && data.user.id) {
          let storageId = data.user.id;
          if (this.state.userData && data.user.id === this.state.userData.id) {
            storageId = data.user.id + '_DUP';
          }

          // DEDUPLICATION AVANCÉE: Chercher par ID ou callsign
          let existing = this.state.peerData.get(storageId);
          let existingUserId = storageId;

          // Si pas trouvé par ID, chercher par callsign
          if (!existing && data.user.callsign) {
            this.state.peerData.forEach((userData: any, userId) => {
              if (userData.callsign === data.user.callsign && userId !== this.state.userData?.id) {
                existing = userData;
                existingUserId = userId;
              }
            });
          }

          // Si l'ID a changé, supprimer l'ancienne entrée
          if (existing && existingUserId !== storageId) {
            console.log('[Connectivity] UPDATE: User ID changed from', existingUserId, 'to', storageId);
            this.state.peerData.delete(existingUserId);
          }

          const userWithNetId = {
            ...(existing || {}),  // Données existantes si trouvées
            ...data.user,         // Nouvelles données
            id: storageId,
            _networkId: existing?._networkId || from
          };

          this.state.peerData.set(storageId, userWithNetId);

          const patchedData = { ...data, user: userWithNetId };
          this.broadcastExcept(from, patchedData);
        } else {
          this.broadcastExcept(from, data);
        }
        break;

      case 'PING':
      case 'LOG_UPDATE':
        this.broadcast(data);
        break;

      case 'PING_MOVE':
      case 'PING_DELETE':
      case 'PING_UPDATE':
        // Avoid echo back to sender for edits/moves (optimization)
        console.log(`[Connectivity] Relaying ${data.type} from ${from}`);
        this.broadcastExcept(from, data);
        break;

      case 'REQUEST_IMAGE':
        // Relay request to everyone (Broadcasting search)
        this.broadcastExcept(from, data);
        break;

      case 'CLIENT_LEAVING':
        this.state.connections.delete(from);

        let userIdToRemove: string | null = null;
        this.state.peerData.forEach((u: any, uid) => {
          if (u._networkId === from) {
            userIdToRemove = uid;
          }
        });

        if (userIdToRemove) {
          console.log('[Connectivity] Removing user mapped to network ID:', userIdToRemove, from);
          this.state.peerData.delete(userIdToRemove);
        } else {
          if (this.state.peerData.has(from)) {
            this.state.peerData.delete(from);
          }
        }

        this.broadcastPeerList();
        break;
    }
  }

  /**
   * Diffuse la liste des peers à tous
   */
  private broadcastPeerList(): void {
    const peers: Record<string, UserData> = {};

    if (this.state.userData) {
      peers[this.state.userData.id] = this.state.userData;
    }

    this.state.peerData.forEach((data, userId) => {
      if (this.state.userData && userId === this.state.userData.id) return;
      peers[userId] = data;
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
