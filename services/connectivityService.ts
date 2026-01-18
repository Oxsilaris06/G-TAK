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
  | { type: 'NEW_HOST_PROMOTED'; hostId: string };

type Listener = (event: ConnectivityEvent) => void;

const RECONNECT_INTERVAL = 3000;
const SYNC_INTERVAL = 2000;
const HANDSHAKE_RETRY = 1000;
// Délai max avant de considérer que la création du Peer a échoué (UDP bloqué ?) et de réessayer
const PEER_CREATION_TIMEOUT = 5000; 

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
  
  // Gestion Réseau
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

  // --- GESTION INTELLIGENTE DU RÉSEAU ---
  
  private setupNetworkMonitor() {
      // On écoute les changements physiques de réseau (Wifi <-> 4G/5G)
      this.netInfoUnsubscribe = NetInfo.addEventListener(state => {
          if (!state.isConnected) return;
          
          const currentType = state.type;
          
          // Si on change de type de réseau (ex: wifi -> cellular), l'IP locale change.
          // Le socket WebRTC actuel devient "zombie" (mort silencieux).
          // Il faut le tuer et le recréer de force.
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

      // Nettoyage préventif des connexions mortes pour éviter les erreurs d'envoi UI
      Object.values(this.connections).forEach(c => { try { c.close(); } catch(e){} });
      this.connections = {};

      // On détruit proprement l'instance actuelle pour fermer les ports
      if (this.peer) {
          try {
            this.peer.destroy();
          } catch (e) { console.warn("Erreur destroy peer:", e); }
          this.peer = null;
      }
      this.isConnecting = false;

      // Petit délai pour laisser le système OS libérer les sockets (vital sur Android)
      setTimeout(() => {
          // On recrée avec le même ID si possible pour que les autres nous retrouvent
          const targetId = (this.role === OperatorRole.HOST && this.user?.id) ? this.user.id : undefined;
          this.createPeer(targetId);
      }, 500);
  }

  public handleAppStateChange(status: AppStateStatus) {
      if (status === 'active') {
          // Vérification de santé au retour de background
          if (!this.peer || this.peer.disconnected || this.peer.destroyed) {
              console.log("[NET] Retour premier plan : Vérification connexion...");
              this.scheduleReconnect(true);
          }
      }
  }

  public async init(user: UserData, role: OperatorRole, targetHostId?: string) {
    this.cleanup(false);
    this.isDestroyed = false;
    
    this.user = { ...user, role };
    this.role = role;
    this.hostId = targetHostId || null;

    // Si on est Host, on génère l'ID nous-même ou on laisse PeerJS le faire
    const myId = role === OperatorRole.HOST ? this.generateShortId() : undefined; 
    
    console.log(`[NET] Init. Role: ${role}, TargetHost: ${targetHostId}`);
    this.createPeer(myId);
  }

  private createPeer(id?: string) {
    if (this.isConnecting) return;
    this.isConnecting = true;

    // Nettoyage timeout précédent
    if (this.creationTimeout) clearTimeout(this.creationTimeout);

    try {
        console.log(`[NET] Création Peer (Tentative avec ID: ${id || 'AUTO'})...`);
        const peer = new Peer(id, CONFIG.PEER_CONFIG as any);
        this.peer = peer;

        // --- TIMEOUT DE SÉCURITÉ (Fix lenteur création) ---
        // Si PeerJS ne répond pas 'open' dans les 5s, on considère que c'est mort (UDP bloqué ou serveur lent)
        // et on retry immédiatement. Ça évite d'attendre 30s le timeout TCP par défaut.
        this.creationTimeout = setTimeout(() => {
            if (!peer.open) {
                console.warn("[NET] Timeout création Peer (>5s). Reset forcé.");
                this.isConnecting = false;
                try { peer.destroy(); } catch(e) {}
                this.createPeer(id); // Retry récursif
            }
        }, PEER_CREATION_TIMEOUT);

        peer.on('open', (peerId) => {
            // Succès ! On annule le timeout de sécurité
            if (this.creationTimeout) clearTimeout(this.creationTimeout);
            
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
                // Client : on se connecte à l'hôte
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
                // Si l'ID est pris (ex: ancien Host fantôme), on en génère un nouveau
                this.notify({ type: 'TOAST', msg: 'ID Hôte indisponible, nouvel ID...', level: 'warning' });
                setTimeout(() => this.createPeer(undefined), 500);
            } else if (err.type === 'peer-unavailable') {
                // L'hôte n'est pas (encore) là
                if (!this.isDestroyed && this.role === OperatorRole.OPR) {
                   console.log(`[NET] Hôte ${this.hostId} introuvable. Retry...`);
                   this.scheduleReconnect();
                }
            } else {
                // Erreurs réseau génériques (socket closed, etc)
                this.scheduleReconnect();
            }
        });

        peer.on('disconnected', () => {
            console.log('[NET] Déconnecté du serveur de signalement (mais P2P peut être actif)');
            if (!this.isDestroyed && this.peer && !this.peer.destroyed) {
                // Tenter une reconnexion douce au serveur de signalement
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
          console.log('[NET] Séquence de reconnexion...');
          if (this.peer) {
              try { this.peer.destroy(); } catch(e) {}
              this.peer = null;
          }
          // On essaye de reprendre notre ID si on était Host pour que les clients nous retrouvent
          const targetId = (this.role === OperatorRole.HOST && this.user?.id) ? this.user.id : undefined;
          this.createPeer(targetId);
      }, delay);
  }

  public connectToHost(targetId: string) {
      if (!this.peer || this.peer.destroyed) return;
      
      console.log(`[NET] Connexion vers Hôte ${targetId}...`);
      
      // Nettoyage ancienne connexion si elle existe
      if (this.connections[targetId]) {
          try { this.connections[targetId].close(); } catch(e) {}
          delete this.connections[targetId];
      }

      const conn = this.peer.connect(targetId, { 
          reliable: true, // TCP-like : Crucial pour éviter la perte de paquets sur 4G/5G
          serialization: 'json',
          metadata: { role: 'OPR', version: '4.0.0' }
      });
      
      this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection) {
      // Timeout de connexion P2P : Si le tunnel ne s'ouvre pas en 8s, on coupe
      const connTimeout = setTimeout(() => {
          if (!conn.open) {
              console.warn(`[NET] Timeout connexion vers ${conn.peer}. Close.`);
              try { conn.close(); } catch(e) {}
          }
      }, 8000);

      conn.on('open', () => {
          clearTimeout(connTimeout);
          console.log(`[NET] Tunnel OUVERT avec ${conn.peer}`);
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
          console.log(`[NET] Tunnel FERMÉ avec ${conn.peer}`);
          this.removePeer(conn.peer); 
          
          if (this.role === OperatorRole.OPR && conn.peer === this.hostId) {
              this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
              // Reconnexion très agressive si on perd l'hôte
              this.scheduleReconnect(true);
          }
      });
      
      conn.on('error', (err) => {
          console.warn(`[NET] Erreur Tunnel ${conn.peer}:`, err);
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
  }

  private startClientHandshake(conn: DataConnection) {
      if (this.handshakeInterval) clearInterval(this.handshakeInterval);
      
      console.log('[NET] Envoi HELLO initial...');
      conn.send({ type: 'HELLO', user: this.user });

      // On répète le Hello jusqu'à recevoir le SYNC (Ack)
      // Utile sur réseaux à forte perte de paquets (Edge/3G/5G saturée)
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
      // Handshake Ack
      if (this.role === OperatorRole.OPR && data.type === 'SYNC') {
          if (this.handshakeInterval) {
              console.log('[NET] Handshake réussi (SYNC reçu).');
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
               // Relais aux autres clients
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
      if (this.creationTimeout) clearTimeout(this.creationTimeout);
      
      // On ne désinscrit PAS le moniteur réseau lors d'un cleanup partiel (reco)
      if (full && this.netInfoUnsubscribe) {
          this.netInfoUnsubscribe();
          this.netInfoUnsubscribe = null;
      }
      
      Object.values(this.connections).forEach(c => { try { c.close(); } catch(e){} });
      this.connections = {};
      this.peersMap = {};
      
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
