import Peer, { DataConnection } from 'peerjs';
import { CONFIG } from '../constants';
import { UserData, OperatorRole, OperatorStatus, LogEntry } from '../types';

export type ConnectivityEvent = 
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEERS_UPDATED'; peers: Record<string, UserData> }
  | { type: 'HOST_CONNECTED'; hostId: string }
  | { type: 'DISCONNECTED'; reason?: string }
  | { type: 'TOAST'; msg: string; level: 'info' | 'error' | 'success' }
  | { type: 'DATA_RECEIVED'; data: any; from: string };

type Listener = (event: ConnectivityEvent) => void;

class ConnectivityService {
  private peer: Peer | null = null;
  private connections: Record<string, DataConnection> = {};
  private listeners: Listener[] = [];
  
  private user: UserData | null = null;
  private hostId: string | null = null;
  private peersMap: Record<string, UserData> = {};
  
  private keepAliveInterval: any = null;

  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(event: ConnectivityEvent) {
    this.listeners.forEach(l => l(event));
  }

  public async init(user: UserData, role: OperatorRole, targetHostId?: string, forceId?: string) {
    // Vérification de sécurité pour éviter le re-init destructif
    if (this.peer && !this.peer.destroyed && this.user?.role === role && (!targetHostId || this.hostId === targetHostId)) {
        return;
    }

    this.cleanup(); 
    this.user = { ...user, role };
    
    // Le filtre ID était soupçonné ici. Notez que generateShortId ne fait que de l'aléatoire.
    // L'absence de targetHostId pour un client provoquera une erreur plus bas, ce qui est normal.
    const myId = forceId || (role === OperatorRole.HOST ? this.generateShortId() : undefined);
    console.log(`[Connectivity] Init TacSuite Link: ${myId || 'AUTO'}`);

    try {
      this.peer = new Peer(myId, CONFIG.PEER_CONFIG as any);

      this.peer.on('open', (id) => {
        console.log(`[Connectivity] Peer Open: ${id}`);
        
        if (this.user) this.user.id = id;
        this.notify({ type: 'PEER_OPEN', id });

        if (role === OperatorRole.HOST) {
          this.hostId = id;
          this.peersMap[id] = this.user!;
          this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
          this.notify({ type: 'TOAST', msg: `RÉSEAU CRÉÉ: ${id}`, level: 'success' });
        } else if (targetHostId) {
          this.connectToHost(targetHostId);
        }
        
        this.startKeepAlive();
      });

      this.peer.on('connection', (conn) => this.handleIncomingConnection(conn));
      
      this.peer.on('error', (err: any) => {
        console.error('[Connectivity] Peer Error:', err);
        // Gestion plus souple des erreurs réseau pour le cas "Même WiFi"
        if (err.type === 'peer-unavailable') {
             this.notify({ type: 'TOAST', msg: 'Hôte introuvable (Vérifiez le réseau)', level: 'error' });
             this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
        } else if (err.type === 'unavailable-id') {
           // Retry auto si ID pris (rare mais possible)
           setTimeout(() => this.init(user, role, targetHostId), 1000);
        } else {
            // Tentative de reconnexion générique
            this.peer?.reconnect();
        }
      });

      this.peer.on('disconnected', () => {
        if (!this.peer?.destroyed) {
            this.peer?.reconnect();
        }
      });

    } catch (e) {
      console.error('Init Failed', e);
      this.notify({ type: 'TOAST', msg: 'Echec init réseau', level: 'error' });
    }
  }

  public connectToHost(targetId: string) {
    if (!this.peer || !this.user) return;
    if (targetId === this.peer.id) return;

    this.hostId = targetId;
    
    if (this.connections[targetId]) {
      this.connections[targetId].close();
    }

    // reliable: true est crucial pour la Main Courante (Logs)
    const conn = this.peer.connect(targetId, { reliable: true, serialization: 'json' });
    this.setupDataConnection(conn);
  }

  private handleIncomingConnection(conn: DataConnection) {
    conn.on('open', () => {
      this.connections[conn.peer] = conn;
      if (this.user?.role === OperatorRole.HOST) {
        const peerList = Object.values(this.peersMap);
        conn.send({ type: 'SYNC', list: peerList });
      }
    });
    this.setupDataConnection(conn);
  }

  private setupDataConnection(conn: DataConnection) {
    this.connections[conn.peer] = conn;

    conn.on('data', (data: any) => {
      if (data && data.type === 'PING_ALIVE') return; 
      this.handleProtocolData(data, conn.peer);
    });

    conn.on('open', () => {
        if (conn.peer === this.hostId) {
             this.notify({ type: 'HOST_CONNECTED', hostId: conn.peer });
             conn.send({ type: 'FULL', user: this.user });
        }
    });

    conn.on('close', () => {
      delete this.connections[conn.peer];
      delete this.peersMap[conn.peer];
      this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
      
      if (conn.peer === this.hostId) {
        this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
      }
    });
    
    conn.on('error', (err) => {
        console.warn(`Conn error with ${conn.peer}`, err);
    });
  }

  private handleProtocolData(data: any, fromId: string) {
    this.notify({ type: 'DATA_RECEIVED', data, from: fromId });

    switch (data.type) {
      case 'FULL': 
      case 'UPDATE': 
      case 'UPDATE_USER':
        if (data.user) {
           this.peersMap[data.user.id] = data.user;
           this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
        }
        break;
      
      case 'SYNC': 
        if (Array.isArray(data.list)) {
           data.list.forEach((u: UserData) => {
             if (u.id !== this.user?.id) this.peersMap[u.id] = u;
           });
           this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
        }
        break;
        
      case 'KICK':
        // C'est ici que la logique de Kick s'applique au niveau réseau.
        // Si fromId n'est pas le HOST, on ignore (sécurité basique)
        if (fromId === this.hostId) {
            this.cleanup();
            this.notify({ type: 'DISCONNECTED', reason: 'KICKED' });
        }
        break;
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

  public updateUserStatus(status: OperatorStatus) {
    if (!this.user) return;
    this.user.status = status;
    this.broadcast({ type: 'UPDATE', user: this.user });
    if (this.user.id) this.peersMap[this.user.id] = this.user;
    this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
  }
  
  public updateUserPosition(lat: number, lng: number, head: number) {
     if(!this.user) return;
     this.user.lat = lat;
     this.user.lng = lng;
     this.user.head = head;
     if(this.user.id) this.peersMap[this.user.id] = this.user;
     this.broadcast({ type: 'UPDATE', user: this.user });
  }

  public updateUser(partialUser: Partial<UserData>) {
      if (!this.user) return;
      this.user = { ...this.user, ...partialUser };
      if (this.user.id) this.peersMap[this.user.id] = this.user;
      this.broadcast({ type: 'UPDATE', user: this.user });
      this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
  }

  private startKeepAlive() {
      if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = setInterval(() => {
          if (this.user && this.peer && !this.peer.destroyed) {
              Object.values(this.connections).forEach(conn => {
                  if (conn.open) conn.send({ type: 'PING_ALIVE' });
              });
          }
      }, 5000);
  }

  public cleanup() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    this.peer?.destroy();
    this.peer = null;
    this.connections = {};
    this.peersMap = {};
    this.hostId = null;
  }

  private generateShortId(): string {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }
}

export const connectivityService = new ConnectivityService();
