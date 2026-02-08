/**
 * Service de Connectivité P2P
 * Gère les connexions PeerJS avec optimisation des performances
 */

import Peer, { DataConnection } from 'peerjs';
import { EventEmitter } from 'events';
import { UserData, OperatorRole } from '../types';
import { configService } from './configService';
import { mmkvStorage } from './mmkvStorage';
import { CONFIG } from '../constants';
import { imageService } from './imageService';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

export type ConnectivityEvent =
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEERS_UPDATED'; peers: Record<string, UserData> }
  | { type: 'HOST_CONNECTED'; hostId: string }
  | { type: 'TOAST'; msg: string; level: string }
  | { type: 'DATA_RECEIVED'; data: any; from: string }
  | { type: 'DISCONNECTED'; reason: 'KICKED' | 'NO_HOST' | 'ERROR' }
  | { type: 'RECONNECTING'; attempt: number }
  | { type: 'NEW_HOST_PROMOTED'; hostId: string }
  | { type: 'SESSION_CLOSED' }
  | { type: 'IMAGE_READY'; imageId: string; uri: string }
  | { type: 'JOIN_REQUEST'; peerId: string; callsign: string };

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
  lastHostHeartbeat: number; // Timestamp du dernier heartbeat de l'hôte
  electionTimeout: NodeJS.Timeout | null; // Timeout pour l'élection du nouvel hôte
  bannedPeers: Set<string>; // ID des utilisateurs bannis
  pendingJoins: Map<string, any>; // Connexions en attente d'approbation (ban)
  peerHeartbeatStats: Map<string, { missedPongs: number; isBackground: boolean }>; // Heartbeat stats
}

class ConnectivityEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }
}

const eventEmitter = new ConnectivityEventEmitter();

export class ConnectivityService {
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
    lastHostHeartbeat: Date.now(),
    electionTimeout: null,
    bannedPeers: new Set(),
    pendingJoins: new Map(),
    // Track stats for heartbeat/timeout
    peerHeartbeatStats: new Map(),
  };

  private lastHeartbeatRun: number = 0; // Pour détecter l'auto-lag de l'hôte

  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  // HEARTBEAT_TIMEOUT Removed (replaced by dynamic interval * threshold)
  private readonly ELECTION_DELAY = 5000; // Délai augmenté à 5s pour stabilisation
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private isInBackground: boolean = false; // État de l'application

  // FIX: Flag to prevent migration processing during intentional disconnect (e.g. back button)
  private isCleaningUp: boolean = false;

  /**
   * Obtient l'intervalle de heartbeat depuis les settings
   */
  private getHeartbeatInterval(): number {
    const baseInterval = configService.get().heartbeatInterval || 10000;
    // En arrière-plan, doubler l'intervalle pour économiser la batterie
    return this.isInBackground ? baseInterval * 2 : baseInterval;
  }

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
    // Reset cleanup flag
    this.isCleaningUp = false;

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
          console.log('[Connectivity] Peer disconnected - attempting reconnection');

          // Utiliser reconnect() pour garder le même Peer ID
          if (this.state.peer && !this.state.peer.destroyed) {
            console.log('[Connectivity] Calling peer.reconnect() to maintain same ID');
            this.state.peer.reconnect();

            // IMPORTANT: Après reconnexion, on doit ré-établir la connexion à l'hôte
            // On attend que le peer soit 'open' à nouveau
            this.state.peer.once('open', (id) => {
              console.log('[Connectivity] Peer reconnected successfully with ID:', id);

              // Si on est un client (OPR) et qu'on a un hostId, se reconnecter à l'hôte
              if (this.state.role === OperatorRole.OPR && this.state.hostId) {
                console.log('[Connectivity] Re-establishing connection to host:', this.state.hostId);

                // Attendre un peu pour que le serveur soit prêt
                setTimeout(() => {
                  this.connectToHost(this.state.hostId);
                }, 500);
              }
            });
          } else {
            console.log('[Connectivity] Peer destroyed, cannot reconnect');
            this.handleDisconnect();
          }
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
    activateKeepAwakeAsync('p2p-connection'); // Keep CPU awake during handshake

    const conn = this.state.peer.connect(hostId, {
      reliable: true,
      serialization: 'json',
    });

    conn.on('open', () => {
      console.log('[Connectivity] Connected to host');
      // We stay awake while connected to host? 
      // LocationService already holds a lock, but redundancy is safe.
      // We will release ONLY on explicit disconnect.

      this.state.connections.set(hostId, conn);
      this.state.hostId = hostId;
      this.emit({ type: 'HOST_CONNECTED', hostId });

      // Envoyer HELLO avec timestamp de connexion
      this.sendTo(hostId, {
        type: 'HELLO',
        user: { ...this.state.userData, connectionTimestamp: Date.now() },
      });
    });

    conn.on('data', (data) => {
      this.handleData(data, hostId);
    });

    conn.on('close', () => {
      console.log('[Connectivity] Host connection closed - initiating migration');
      this.state.connections.delete(hostId);

      // On release le lock temporaire si on perd la co, 
      // mais si on reconnecte on le reprendra. 
      // En réalité, on veut sans doute GARDER le lock tant qu'on essaie de se reconnecter.
      // deactivateKeepAwake('p2p-connection'); 

      // Déclencher l'élection du nouvel hôte après un délai
      this.handleHostDisconnection();
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

      // NOTE: On ne supprime PAS les données utilisateur ici pour éviter
      // une race condition lors des reconnexions. Le HELLO handler gère
      // déjà la mise à jour du _networkId.

      console.log('[Connectivity] Keeping user data for potential reconnection');

      // On broadcast pour mettre à jour les statuts
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
        // Using alert temporarily for debug, but better to use toast
        this.emit({ type: 'TOAST', msg: `Host: Image demandée INTROUVABLE ${imageId}`, level: 'error' });
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

        // BACKGROUND FIX: Pulse connection every 10 chunks to prevent timeout during transfer
        if (i % 10 === 0) {
          this.pulse();
        }

        // SLOW DOWN: 20ms wait per chunk to ensure UDP/WebRTC buffers don't overflow
        await new Promise(r => setTimeout(r, 20));
      }

    } catch (e) {
      console.error('[Connectivity] Error sending image:', e);
    }
  }

  private handleData(data: any, from: string): void {
    if (!data || typeof data !== 'object') return;

    // --- HEARTBEAT PROTOCOL HANDLERS ---
    if (data.type === 'HEARTBEAT_PING') {
      // Update last heartbeat timestamp to prevent timeout disconnection
      this.state.lastHostHeartbeat = Date.now();
      // Send PONG back to host to confirm we are alive
      this.sendTo(from, { type: 'HEARTBEAT_PONG' });
      return;
    }

    // ACTIVITY AS HEARTBEAT (PASSIVE): Any valid data reset timeout
    if (this.state.role === OperatorRole.OPR && from === this.state.hostId) {
      this.state.lastHostHeartbeat = Date.now();
    } else if (this.state.role === OperatorRole.HOST) {
      const stats = this.state.peerHeartbeatStats.get(from);
      if (stats) stats.missedPongs = 0;
      const peer = this.state.peerData.get(from);
      if (peer) peer.connectionTimestamp = Date.now();
    }

    // REACTIVE KEEP-ALIVE (ACTIVE): Reply to notifications to keep link alive
    // "Receiving a notification obliges the sending of a ping/pong"
    const NOTIFICATION_TYPES = ['PING_UPDATE', 'PING', 'MSG', 'LOG_UPDATE', 'TOAST'];
    // Also specific user updates like CONTACT
    const isContactUpdate = data.type === 'UPDATE_USER' && data.user?.status === 'CONTACT';

    if (NOTIFICATION_TYPES.includes(data.type) || isContactUpdate) {
      // Force a PONG to confirm reception and refresh NAT
      this.sendTo(from, { type: 'HEARTBEAT_PONG' });
    }

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
        if (data.user && data.user.id) {
          let storageId = data.user.id;

          // PROTECTION: Si collision avec l'ID de l'Host, on suffixe
          if (this.state.userData && data.user.id === this.state.userData.id) {
            console.warn('[Connectivity] ID Collision with Host. Suffixing client:', from);
            storageId = data.user.id + '_DUP';
          }

          // --- BAN CHECK ---
          if (this.state.bannedPeers.has(storageId)) {
            console.warn('[Connectivity] Banned user attempted to join:', data.user.callsign, storageId);

            // Stocker la demande en attente
            this.state.pendingJoins.set(storageId, {
              networkId: from,
              userData: { ...data.user, id: storageId, _networkId: from },
              rawHello: data
            });

            // Notifier l'Hôte pour décision
            this.emit({
              type: 'JOIN_REQUEST',
              peerId: storageId,
              callsign: data.user.callsign || 'Inconnu'
            });
            return; // STOP l'exécution ici, ne pas ajouter aux peerData
          }
          // -----------------

          // DEBUG: Afficher l'état actuel de peerData
          console.log('[Connectivity] === HELLO RECEIVED ===');
          console.log('[Connectivity] From network ID:', from);
          console.log('[Connectivity] User ID:', storageId);
          console.log('[Connectivity] Callsign:', data.user.callsign);
          console.log('[Connectivity] Current peerData entries:', Array.from(this.state.peerData.keys()));

          // DEDUPLICATION PAR ID (peer.reconnect() maintient l'ID stable)
          const existingUser = this.state.peerData.get(storageId);

          if (existingUser) {
            console.log('[Connectivity] User FOUND in peerData');
            console.log('[Connectivity] Existing network ID:', existingUser._networkId);

            // Utilisateur existe - vérifier si c'est une RECONNEXION (nouveau network ID)
            if (existingUser._networkId !== from) {
              // RECONNEXION: Même ID utilisateur, mais NOUVEAU network ID
              console.log('[Connectivity] *** RECONNECTION DETECTED ***');
              console.log('[Connectivity]   User ID:', storageId);
              console.log('[Connectivity]   Old network ID:', existingUser._networkId);
              console.log('[Connectivity]   New network ID:', from);

              // Nettoyer l'ancienne connexion réseau
              const oldNetworkId = existingUser._networkId;
              if (oldNetworkId && this.state.connections.has(oldNetworkId)) {
                console.log('[Connectivity] Closing stale connection:', oldNetworkId);
                const oldConn = this.state.connections.get(oldNetworkId);
                if (oldConn) oldConn.close();
                this.state.connections.delete(oldNetworkId);
              } else {
                console.log('[Connectivity] Old connection already closed:', oldNetworkId);
              }

              // Mettre à jour avec le nouveau network ID
              const updatedUser = {
                ...existingUser,  // Garder les données existantes (position, etc.)
                ...data.user,     // Appliquer les nouvelles données
                id: storageId,    // Garder le même ID
                _networkId: from  // NOUVEAU network ID
              };
              this.state.peerData.set(storageId, updatedUser);
              console.log('[Connectivity] Updated existing entry with new network ID');
            } else {
              // Même network ID - simple mise à jour (rare)
              console.log('[Connectivity] Updating existing user (same network ID):', storageId);
              const updatedUser = { ...existingUser, ...data.user, id: storageId, _networkId: from };
              this.state.peerData.set(storageId, updatedUser);
            }
          } else {
            console.log('[Connectivity] User NOT FOUND in peerData - creating new entry');

            // NOUVEAU CLIENT: Pas d'entrée avec cet ID
            const userWithNetId = { ...data.user, id: storageId, _networkId: from };
            this.state.peerData.set(storageId, userWithNetId);
            console.log('[Connectivity] *** NEW CLIENT CONNECTED ***');
            console.log('[Connectivity]   User ID:', storageId);
            console.log('[Connectivity]   Network ID:', from);
            console.log('[Connectivity]   Callsign:', data.user.callsign);
          }

          console.log('[Connectivity] peerData after HELLO:', Array.from(this.state.peerData.keys()));

          // RESET HEARTBEAT STATS: Welcome back!
          this.state.peerHeartbeatStats.set(storageId, { missedPongs: 0, isBackground: false });

          console.log('[Connectivity] === END HELLO ===');
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

      case 'REQUEST_RESYNC':
        // Le nouvel hôte demande une resynchronisation complète
        console.log('[Connectivity] Relaying resync request from new host');
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

      case 'HEARTBEAT':
        // Update timestamp for the user associated with this network ID
        let found = false;
        this.state.peerData.forEach((u: any, uid) => {
          if (u._networkId === from || uid === from) {
            u.connectionTimestamp = Date.now();
            found = true;
          }
        });

        // If not found by network ID, try to find by ID if passed in data (security check needed?)
        // Usually HEARTBEAT doesn't carry ID, we trust 'from'.
        // If we found the user, great. If not, they might be ghosting.
        break;

      case 'HEARTBEAT_PONG':
        // Update timestamp for the user associated with this network ID
        // console.log('[Connectivity] Received PONG from', from);
        this.state.peerData.forEach((u: any, uid) => {
          if (u._networkId === from || uid === from) {
            u.connectionTimestamp = Date.now();
          }
        });
        break;
    }
  }

  /**
   * Approuve la connexion d'un utilisateur banni (Déban + Connexion)
   */
  approveJoin(peerId: string): void {
    const pending = this.state.pendingJoins.get(peerId);
    if (pending) {
      console.log('[Connectivity] Approving join for:', peerId);
      this.state.bannedPeers.delete(peerId); // Unban

      // Traiter le message HELLO stocké comme si de rien n'était
      // On réinjecte le HELLO dans le pipeline
      this.handleHostData(pending.rawHello, pending.networkId);

      this.state.pendingJoins.delete(peerId);
    }
  }

  /**
   * Refuse la connexion d'un utilisateur banni
   */
  denyJoin(peerId: string): void {
    const pending = this.state.pendingJoins.get(peerId);
    if (pending) {
      console.log('[Connectivity] Denying join for:', peerId);
      this.sendTo(pending.networkId, { type: 'DISCONNECTED', reason: 'KICKED' });
      // Fermer la connexion
      const conn = this.state.connections.get(pending.networkId);
      if (conn) conn.close();

      this.state.pendingJoins.delete(peerId);
    }
  }

  /**
   * Bannir un utilisateur
   */
  banUser(peerId: string): void {
    console.log('[Connectivity] Banning user:', peerId);
    this.state.bannedPeers.add(peerId);
    this.kickUser(peerId); // Kick immédiat
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
      // BACKGROUND FIX: Pulse pour maintenir connexion lors de changements d'état
      this.pulse();
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
   * Démarre le heartbeat (clients envoient à l'hôte)
   */
  /**
   * Pulse: Called externally (e.g. by Location Service) to drive the heartbeat loop
   * independent of JS timers which may throttle in background.
   */
  pulse(): void {
    const now = Date.now();
    const interval = this.getHeartbeatInterval();

    // Safety check: Don't pulse too often (debounce)
    if (now - this.lastHeartbeatRun < (interval * 0.8)) {
      return;
    }

    // Execute Heartbeat Logic
    this.executeHeartbeatCycle();
  }

  /**
   * Logic previously in setInterval
   */
  private executeHeartbeatCycle(): void {
    const now = Date.now();
    // this.lastHeartbeatRun is updated in checkClientHeartbeats or here
    // We update it here to be safe, but checkClientHeartbeats also uses it for lag detection.

    if (this.state.role === OperatorRole.HOST) {
      // L'hôte envoie un PING à TOUS les clients connectés
      this.broadcast({ type: 'HEARTBEAT_PING', timestamp: now });
      // L'hôte vérifie aussi les timeouts
      this.checkClientHeartbeats();
    } else {
      // CLIENT LOOP
      const timeSinceLastHostPing = now - this.state.lastHostHeartbeat;
      const TIMEOUT = this.getHeartbeatInterval() * 4;

      if (timeSinceLastHostPing > TIMEOUT) {
        console.warn(`[Connectivity] Host heartbeat timeout (${timeSinceLastHostPing}ms > ${TIMEOUT}ms). Triggering disconnection handler.`);
        this.handleHostDisconnection();
      }
    }
  }

  /**
   * Démarre le heartbeat (clients envoient à l'hôte)
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.getHeartbeatInterval();
    console.log(`[Connectivity] Starting heartbeat with ${interval}ms interval`);

    // We still keep setInterval as a fallback for Foreground
    this.heartbeatInterval = setInterval(() => {
      this.pulse();
    }, interval);
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
   * Vérifie les heartbeats des clients (côté hôte)
   */


  /**
   * Envoie l'état de l'application aux autres peers
   */
  sendAppState(state: 'active' | 'background'): void {
    const isBackground = state === 'background';
    this.isInBackground = isBackground;

    // Broadcast status change so others know we might be slow/throttled
    if (this.state.userData) {
      this.state.userData.isBackground = isBackground;
      this.broadcast({
        type: 'UPDATE_USER', // Or 'UPDATE' if that's what we use? 
        // Checking updateUser (839) uses 'UPDATE_USER'.
        // updateUserPosition (849) uses 'UPDATE'.
        // Let's use 'UPDATE_USER' as it seems safer for full user object updates.
        user: this.state.userData,
      });
    }
  }

  /**
   * Gère le changement d'état de l'app
   */
  handleAppStateChange(state: 'active' | 'background'): void {
    this.sendAppState(state); // Forward to sendAppState which now handles logic + network

    const wasInBackground = this.isInBackground;
    // this.isInBackground is updated in sendAppState, but we check here for local side effects

    console.log(`[Connectivity] App state changed to: ${state}`);

    if (wasInBackground !== (state === 'background')) {
      // Redémarrer le heartbeat avec le nouvel intervalle
      if (this.state.peer && !this.state.peer.destroyed) {
        this.startHeartbeat();
      }
    }

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
   * Vérifie les heartbeat des clients
   */
  private checkClientHeartbeats(): void {
    const now = Date.now();
    const interval = this.getHeartbeatInterval();

    // === SECURITY CHECK: HOST LAG ===
    // Si l'hôte a "sauté" un cycle (lag > 2x interval), 
    // on annule ce check pour ne pas kicker tout le monde injustement.
    if (this.lastHeartbeatRun > 0 && (now - this.lastHeartbeatRun) > (interval * 2.5)) {
      console.warn('[Connectivity] Host lag detected (skipped cycles). Skipping timeout checks to prevent mass kick.');
      this.lastHeartbeatRun = now;
      return;
    }
    this.lastHeartbeatRun = now;
    // ================================

    const TIMEOUT_THRESHOLD_PONGS = 12; // 12 pongs ratés = Kick (environ 2 min)

    this.state.peerData.forEach((user, peerId) => {
      // Ne pas vérifier l'hôte lui-même
      if (peerId === this.state.hostId) return;

      let stats = this.state.peerHeartbeatStats.get(peerId);
      if (!stats) {
        stats = { missedPongs: 0, isBackground: false };
        this.state.peerHeartbeatStats.set(peerId, stats);
      }

      // Incrémenter le compteur de pongs ratés
      // (Il sera reset à 0 quand on reçoit un HEARTBEAT_PONG dans handleData)
      stats.missedPongs++;

      // Calculer le seuil effectif
      // Si en background, on double la tolérance (ou plus, selon besoin)
      const effectiveThreshold = stats.isBackground ? (TIMEOUT_THRESHOLD_PONGS * 2) : TIMEOUT_THRESHOLD_PONGS;

      if (stats.missedPongs >= effectiveThreshold) {
        console.log(`[Connectivity] Client ${user.callsign} (${peerId}) timed out. Missed: ${stats.missedPongs}/${effectiveThreshold} (BG: ${stats.isBackground})`);
        // Timeout -> Kick
        this.emit({ type: 'TOAST', msg: `${user.callsign} déconnecté (Timeout)`, level: 'warning' });
        this.kickUser(peerId);
      }
    });
  }

  /**
   * Émet un événement
   */
  private emit(event: ConnectivityEvent): void {
    eventEmitter.emit('event', event);
  }

  /**
   * === HOST MIGRATION FUNCTIONS ===
   */

  /**
   * Gère la déconnexion de l'hôte
   */
  private handleHostDisconnection(): void {
    // FIX: Do not start election if we are intentionally disconnecting
    if (this.isCleaningUp) {
      console.log('[Connectivity] Intentional disconnection (cleanup) - skipping host election');
      return;
    }

    console.log('[Connectivity] Host disconnected - starting election process');

    // SECURITY: ZOMBIE CHECK (ISOLATED CLIENT)
    // Si je suis tout seul (connecté uniquement à l'hôte qui vient de mourir),
    // je ne dois PAS devenir hôte, car je suis probablement partitionné.
    // peerData contient (Moi + Host + Autres). 
    // Si je ne vois que Moi et Host (ou juste Moi), je suis seul.

    // Note: connections contient les DataConnection.
    // En tant que Client, on est connecté à l'Hôte... et c'est tout ?
    // NON! En Mesh, on est connecté aux autres ? 
    // ATTENTION: Dans ce code, on dirait une architecture Étoile (Client <-> Host).
    // Si architecture Étoile : Si Host meurt, les clients ne se voient plus !
    // Donc l'élection est impossible en pure étoile sans reconnexion Mesh.
    // MAIS : Le code electNewHost trie 'this.state.peerData'.
    // Si peerData n'est pas vide, c'est que j'ai reçu la liste des autres via 'PEERS_UPDATED'.
    // Donc je CONNAIS les autres, même si je n'ai pas de connexion directe ouverte (si l'architecture est Star).
    // Sauf si 'connections' sont required pour l'élection.

    // ZOMBIE CHECK REVISITED:
    // Si ça fait très longtemps que je n'ai pas eu de 'PEERS_UPDATED' ou de 'PING' d'un autre...
    // Simplification : Si je suis le seul dans ma liste peerData (filtrée sans l'hôte), je suis seul.
    const potentialPeers = Array.from(this.state.peerData.keys())
      .filter(id => id !== this.state.hostId && id !== this.state.userData?.id);

    if (potentialPeers.length === 0) {
      console.warn('[Connectivity] I am isolated (no other peers known). Reconnecting instead of electing.');
      this.state.electionTimeout = setTimeout(() => {
        this.attemptReconnect();
      }, 1000);
      return;
    }

    // Annuler tout timeout d'élection en cours
    if (this.state.electionTimeout) {
      clearTimeout(this.state.electionTimeout);
    }

    // Attendre ELECTION_DELAY avant d'élire un nouvel hôte
    this.state.electionTimeout = setTimeout(() => {
      const newHostId = this.electNewHost();

      if (newHostId === this.state.userData?.id) {
        // Je suis le plus ancien - devenir hôte
        console.log('[Connectivity] I am the oldest client - promoting to host');
        this.promoteToHost();
      } else if (newHostId) {
        // Un autre est plus ancien - se reconnecter à lui
        console.log('[Connectivity] Another client is older - reconnecting to:', newHostId);
        this.reconnectToNewHost(newHostId);
      } else {
        // Aucun client disponible - fermer la session
        console.log('[Connectivity] No clients available - closing session');
        this.closeSession();
      }
    }, this.ELECTION_DELAY);
  }

  /**
   * Élit le nouvel hôte (le client le plus ancien)
   */
  private electNewHost(): string | null {
    const peers = Array.from(this.state.peerData.entries())
      .filter(([id]) => id !== this.state.hostId) // Exclure l'ancien hôte
      .filter(([_, user]) => user.connectionTimestamp) // Seulement ceux avec timestamp
      .sort((a, b) => (a[1].connectionTimestamp || 0) - (b[1].connectionTimestamp || 0));

    // Ajouter moi-même dans la liste si je suis client
    if (this.state.role === OperatorRole.OPR && this.state.userData) {
      const myTimestamp = this.state.userData.connectionTimestamp || Date.now();
      peers.push([this.state.userData.id, { ...this.state.userData, connectionTimestamp: myTimestamp }]);
      peers.sort((a, b) => (a[1].connectionTimestamp || 0) - (b[1].connectionTimestamp || 0));
    }

    console.log('[Connectivity] Election candidates:', peers.map(([id, user]) => ({
      id,
      callsign: user.callsign,
      timestamp: user.connectionTimestamp
    })));

    return peers.length > 0 ? peers[0][0] : null;
  }

  /**
   * Promouvoir ce client en hôte
   */
  private promoteToHost(): void {
    console.log('[Connectivity] === PROMOTING TO HOST ===');

    this.state.role = OperatorRole.HOST;
    this.state.hostId = this.state.userData!.id;

    // Mettre à jour le rôle dans userData
    if (this.state.userData) {
      this.state.userData.role = OperatorRole.HOST;
    }

    // Notifier l'UI
    this.emit({ type: 'NEW_HOST_PROMOTED', hostId: this.state.hostId });
    this.emit({ type: 'TOAST', msg: 'Vous êtes maintenant l\'hôte de la session', level: 'info' });

    // Demander une resynchronisation complète aux autres clients
    this.requestFullResync();
  }

  /**
   * Demander une resynchronisation complète des données
   */
  private requestFullResync(): void {
    console.log('[Connectivity] Requesting full resync from all clients');

    // Envoyer une demande de resync à tous les clients connectés
    this.state.connections.forEach((conn, peerId) => {
      this.sendTo(peerId, {
        type: 'REQUEST_RESYNC',
        timestamp: Date.now()
      });
    });
  }

  /**
   * Se reconnecter au nouvel hôte
   */
  private reconnectToNewHost(newHostId: string): void {
    console.log('[Connectivity] Reconnecting to new host:', newHostId);

    this.state.hostId = newHostId;

    // Notifier l'UI
    this.emit({ type: 'TOAST', msg: 'Reconnexion au nouvel hôte...', level: 'info' });

    // Se connecter au nouvel hôte après un délai
    setTimeout(() => {
      this.connectToHost(newHostId);
    }, 1000);
  }

  /**
   * Fermer la session proprement
   */
  private closeSession(): void {
    console.log('[Connectivity] === CLOSING SESSION ===');
    console.log('[Connectivity] No clients available to become host');

    // Émettre événement pour arrêter le tracking
    this.emit({ type: 'SESSION_CLOSED' });
    this.emit({ type: 'TOAST', msg: 'Session fermée - aucun hôte disponible', level: 'warning' });

    // Nettoyer les connexions
    this.state.peerData.clear();
    this.state.connections.clear();
    this.state.hostId = '';
  }

  /**
   * Nettoie toutes les connexions
   */
  cleanup(): void {
    console.log('[Connectivity] Cleaning up services');
    deactivateKeepAwake('p2p-connection');
    this.isCleaningUp = true; // Fix: Mark as intentional cleanup
    this.stopHeartbeat();

    this.state.pendingJoins.clear();
    // On ne vide PAS bannedPeers ici pour garder le ban actif tant que l'app tourne ?
    // Ou on vide si logout ? Le user a dit "reconnexion évaluée par l'hôte", 
    // donc ça sous-entend persistance tant que la session (Host) est active.
    // Si l'hôte redémarre l'app, la liste est perdue (ce qui est logique en P2P éphémère).


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
