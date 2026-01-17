import Peer, { DataConnection } from 'peerjs';
import { CONFIG } from '../constants';
import { UserData, OperatorRole, OperatorStatus } from '../types';

export type ConnectivityEvent = 
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEERS_UPDATED'; peers: Record<string, UserData> }
  | { type: 'HOST_CONNECTED'; hostId: string }
  | { type: 'DISCONNECTED'; reason: 'KICKED' | 'NO_HOST' | 'NETWORK_ERROR' | 'MANUAL' }
  | { type: 'RECONNECTING'; attempt: number }
  | { type: 'TOAST'; msg: string; level: 'info' | 'error' | 'success' }
  | { type: 'DATA_RECEIVED'; data: any; from: string }
  | { type: 'MIGRATION_START' }
  | { type: 'NEW_HOST_PROMOTED'; hostId: string };

type Listener = (event: ConnectivityEvent) => void;

// Délais critiques pour mobile
const RECONNECT_INTERVAL = 3000;
const SYNC_INTERVAL = 2000; // Heartbeat Host (comme comtac.html)
const HANDSHAKE_RETRY = 1000; // Client insiste tant que pas connecté

class ConnectivityService {
  private peer: Peer | null = null;
  private connections: Record<string, DataConnection> = {};
  private listeners: Listener[] = [];
  
  // État local
  private user: UserData | null = null;
  private hostId: string | null = null;
  private role: OperatorRole = OperatorRole.OPR;
  private peersMap: Record<string, UserData> = {};
  
  // Timers
  private syncInterval: any = null;
  private retryTimeout: any = null;
  private handshakeInterval: any = null;
  
  private isDestroyed = false;

  // --- PUBLIC API ---

  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private notify(event: ConnectivityEvent) {
    this.listeners.forEach(l => l(event));
  }

  public async init(user: UserData, role: OperatorRole, targetHostId?: string) {
    this.cleanup(false); // Reset propre mais garde l'état "vivant"
    this.isDestroyed = false;
    
    this.user = { ...user, role };
    this.role = role;
    this.hostId = targetHostId || null;

    // ID Statique pour l'hôte pour faciliter la reconnexion, aléatoire pour client
    // Note: Utiliser un ID aléatoire court évite les problèmes de "ID Taken" fantômes
    const myId = role === OperatorRole.HOST ? this.generateShortId() : undefined; 
    
    console.log(`[NET] Init. Role: ${role}, TargetHost: ${targetHostId}`);
    this.createPeer(myId);
  }

  // --- PEER LIFECYCLE ---

  private createPeer(id?: string) {
    try {
        const peer = new Peer(id, CONFIG.PEER_CONFIG as any);
        this.peer = peer;

        peer.on('open', (peerId) => {
            console.log(`[NET] Peer OPEN: ${peerId}`);
            if (this.user) this.user.id = peerId;
            this.notify({ type: 'PEER_OPEN', id: peerId });

            if (this.role === OperatorRole.HOST) {
                this.hostId = peerId;
                this.peersMap[peerId] = this.user!;
                this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
                this.notify({ type: 'TOAST', msg: `Canal Hôte: ${peerId}`, level: 'success' });
                this.startHostSync();
            } else if (this.hostId) {
                this.connectToHost(this.hostId);
            }
        });

        peer.on('connection', (conn) => {
            this.setupConnection(conn);
        });

        peer.on('error', (err: any) => {
            console.error(`[NET] Error: ${err.type}`, err);
            if (err.type === 'unavailable-id') {
                // Si ID pris, on réessaie avec un nouveau (ou auto)
                this.notify({ type: 'TOAST', msg: 'ID indisponible, nouvel essai...', level: 'warning' });
                setTimeout(() => this.createPeer(undefined), 1000);
            } else if (err.type === 'peer-unavailable') {
                // Hôte pas trouvé, on réessaie plus tard
                if (!this.isDestroyed) {
                    this.notify({ type: 'TOAST', msg: 'Hôte introuvable...', level: 'error' });
                    this.scheduleReconnect();
                }
            } else if (err.type === 'network' || err.type === 'disconnected') {
                this.scheduleReconnect();
            }
        });

        peer.on('disconnected', () => {
            console.log('[NET] Disconnected from signalling server');
            // PeerJS peut se reconnecter au serveur de signalisation sans tout casser
            if (!this.isDestroyed && this.peer && !this.peer.destroyed) {
                this.peer.reconnect();
            }
        });

        peer.on('close', () => {
            console.log('[NET] Peer Closed');
            if (!this.isDestroyed) this.scheduleReconnect();
        });

    } catch (e) {
        console.error('[NET] Crash creation', e);
        this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
      if (this.retryTimeout) clearTimeout(this.retryTimeout);
      this.retryTimeout = setTimeout(() => {
          console.log('[NET] Reconnecting...');
          // On détruit tout pour repartir sur une base saine (Hard Reset)
          if (this.peer) this.peer.destroy();
          this.createPeer(this.role === OperatorRole.HOST && this.user?.id ? this.user.id : undefined);
      }, RECONNECT_INTERVAL);
  }

  // --- CONNECTION MANAGEMENT ---

  public connectToHost(targetId: string) {
      if (!this.peer || this.peer.destroyed) return;
      
      console.log(`[NET] Connecting to ${targetId}...`);
      
      // Fermeture des anciennes connexions vers cet hôte
      if (this.connections[targetId]) {
          this.connections[targetId].close();
          delete this.connections[targetId];
      }

      // CRITIQUE : serialization: 'json' est obligatoire pour Android/Hermes
      const conn = this.peer.connect(targetId, { 
          reliable: true, 
          serialization: 'json' 
      });
      
      this.setupConnection(conn);
  }

  private setupConnection(conn: DataConnection) {
      // Gestionnaire unique pour connexions entrantes (Host) et sortantes (Client)
      
      conn.on('open', () => {
          console.log(`[NET] Tunnel OPEN with ${conn.peer}`);
          this.connections[conn.peer] = conn;

          if (this.role === OperatorRole.HOST) {
              // L'hôte envoie immédiatement un SYNC pour débloquer le client
              this.sendSync(conn);
          } else {
              // Le client envoie son profil en boucle jusqu'à recevoir une réponse
              // C'est le "Aggressive Handshake"
              this.notify({ type: 'HOST_CONNECTED', hostId: conn.peer });
              this.startClientHandshake(conn);
          }
      });

      conn.on('data', (data) => this.handleData(data, conn.peer));
      
      conn.on('close', () => {
          console.log(`[NET] Tunnel CLOSE with ${conn.peer}`);
          delete this.connections[conn.peer];
          delete this.peersMap[conn.peer];
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
          
          if (this.role === OperatorRole.OPR && conn.peer === this.hostId) {
              this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
              // Tenter de se reconnecter
              this.scheduleReconnect();
          }
      });
      
      conn.on('error', (err) => {
          console.warn(`[NET] Conn Error ${conn.peer}`, err);
          conn.close();
      });
  }

  // --- DATA LOGIC ---

  private startClientHandshake(conn: DataConnection) {
      if (this.handshakeInterval) clearInterval(this.handshakeInterval);
      
      // Envoie le profil toutes les secondes tant que la connexion est ouverte
      // S'arrêtera quand on recevra un SYNC (voir handleData)
      this.handshakeInterval = setInterval(() => {
          if (conn.open) {
              console.log('[NET] Sending HELLO...');
              conn.send({ type: 'HELLO', user: this.user });
          } else {
              clearInterval(this.handshakeInterval);
          }
      }, HANDSHAKE_RETRY);
  }

  private startHostSync() {
      if (this.syncInterval) clearInterval(this.syncInterval);
      
      // Heartbeat de l'hôte : diffuse l'état complet à tout le monde
      this.syncInterval = setInterval(() => {
          const list = Object.values(this.peersMap);
          // On s'ajoute soi-même (hôte) à la liste
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
      // console.log(`[NET] RX form ${fromId}:`, data.type);

      // Si je suis client et que je reçois un SYNC, le handshake est réussi
      if (this.role === OperatorRole.OPR && data.type === 'SYNC') {
          if (this.handshakeInterval) {
              clearInterval(this.handshakeInterval);
              this.handshakeInterval = null;
              this.notify({ type: 'TOAST', msg: 'Synchronisé', level: 'success' });
          }
      }

      this.notify({ type: 'DATA_RECEIVED', data, from: fromId });

      // Mise à jour du state interne
      if (data.type === 'HELLO' || data.type === 'UPDATE' || data.type === 'UPDATE_USER') {
          if (data.user) {
              this.peersMap[data.user.id] = data.user;
              this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
              // Si je suis hôte et que je reçois un HELLO, je réponds par un SYNC immédiat
              if (this.role === OperatorRole.HOST && data.type === 'HELLO') {
                  const conn = this.connections[fromId];
                  if (conn) this.sendSync(conn);
              }
          }
      } else if (data.type === 'SYNC' && Array.isArray(data.list)) {
          data.list.forEach((u: UserData) => {
              if (u.id !== this.user?.id) this.peersMap[u.id] = u;
          });
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
      } else if (data.type === 'KICK' && fromId === this.hostId) {
          this.cleanup();
          this.notify({ type: 'DISCONNECTED', reason: 'KICKED' });
      }
  }

  // --- ACTIONS ---

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
      // Optimisation: on ne notifie pas l'UI locale pour le GPS (trop fréquent), juste broadcast
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
      if (this.syncInterval) clearInterval(this.syncInterval);
      if (this.handshakeInterval) clearInterval(this.handshakeInterval);
      if (this.retryTimeout) clearTimeout(this.retryTimeout);
      
      Object.values(this.connections).forEach(c => c.close());
      this.connections = {};
      this.peersMap = {};
      
      if (this.peer) {
          this.peer.destroy();
          this.peer = null;
      }
  }

  private generateShortId(): string {
      return Math.random().toString(36).substring(2, 10).toUpperCase();
  }
}

export const connectivityService = new ConnectivityService();
