import Peer, { DataConnection } from 'peerjs';
import { CONFIG } from '../constants';
import { UserData, OperatorRole, OperatorStatus } from '../types';

// Types d'événements que le service peut émettre vers l'UI
export type ConnectivityEvent = 
  | { type: 'PEER_OPEN'; id: string }
  | { type: 'PEERS_UPDATED'; peers: Record<string, UserData> }
  | { type: 'HOST_CONNECTED'; hostId: string }
  | { type: 'DISCONNECTED'; reason?: string }
  | { type: 'TOAST'; msg: string; level: 'info' | 'error' | 'success' }
  | { type: 'DATA_RECEIVED'; data: any; from: string }
  | { type: 'MIGRATION_START' }
  | { type: 'NEW_HOST_PROMOTED'; hostId: string };

type Listener = (event: ConnectivityEvent) => void;

class ConnectivityService {
  private peer: Peer | null = null;
  // On ne garde que les connexions DATA (Texte/JSON)
  private connections: Record<string, DataConnection> = {};
  
  private listeners: Listener[] = [];
  
  private user: UserData | null = null;
  private hostId: string | null = null;
  private peersMap: Record<string, UserData> = {};
  
  private isMigrating: boolean = false;
  
  // --- GESTION DES ABONNEMENTS (Observer Pattern) ---
  
  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(event: ConnectivityEvent) {
    this.listeners.forEach(l => l(event));
  }

  // --- INITIALISATION & CONNEXION ---

  public async init(user: UserData, role: OperatorRole, targetHostId?: string, forceId?: string) {
    this.cleanup(); // Nettoyage préventif
    this.user = { ...user, role };
    
    const myId = forceId || (role === OperatorRole.HOST ? this.generateShortId() : undefined);
    console.log(`[Connectivity] Init Data-Link with ID: ${myId || 'AUTO'} as ${role}`);

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
          this.notify({ type: 'TOAST', msg: `RÉSEAU TACTIQUE CRÉÉ: ${id}`, level: 'success' });
        } else if (targetHostId) {
          this.connectToHost(targetHostId);
        }
      });

      this.peer.on('connection', (conn) => this.handleIncomingConnection(conn));
      
      this.peer.on('error', (err: any) => {
        console.error('[Connectivity] Peer Error:', err);
        this.notify({ type: 'TOAST', msg: `Erreur Réseau: ${err.type}`, level: 'error' });
        
        if (err.type === 'unavailable-id') {
           this.notify({ type: 'TOAST', msg: 'ID indisponible, nouvel essai...', level: 'info' });
           setTimeout(() => this.init(user, role, targetHostId), 1000);
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

    console.log(`[Connectivity] Connecting to Host (Data Only): ${targetId}`);
    this.hostId = targetId;
    
    if (this.connections[targetId]) {
      this.connections[targetId].close();
    }

    // Connexion DATA fiable
    const conn = this.peer.connect(targetId, { reliable: true });
    this.setupDataConnection(conn);
  }

  // --- GESTION DES HANDLERS ---

  private handleIncomingConnection(conn: DataConnection) {
    conn.on('open', () => {
      this.connections[conn.peer] = conn;
      if (this.user?.role === OperatorRole.HOST) {
        // Envoi de la situation tactique (liste des pairs) au nouvel arrivant
        const peerList = Object.values(this.peersMap);
        conn.send({ type: 'SYNC', list: peerList });
      }
    });
    this.setupDataConnection(conn);
  }

  private setupDataConnection(conn: DataConnection) {
    this.connections[conn.peer] = conn;

    conn.on('data', (data: any) => {
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
      
      if (conn.peer === this.hostId && !this.isMigrating) {
        this.handleHostLoss();
      }
    });
  }

  // --- DATA HANDLING ---

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

      case 'HOST_MIGRATE_INSTRUCTION':
        this.notify({ type: 'TOAST', msg: 'ORDRE MIGRATION REÇU', level: 'info' });
        this.handleMigrationOrder();
        break;
        
      case 'KICK':
        if (fromId === this.hostId) {
            this.cleanup();
            this.notify({ type: 'DISCONNECTED', reason: 'KICKED' });
        }
        break;
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
    } else {
        console.warn(`[Connectivity] Cannot send to ${targetId}, connection not open.`);
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
     // On update la map locale sans déclencher de re-render complet UI immédiat si possible
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

  public cleanup() {
    this.peer?.destroy();
    this.peer = null;
    this.connections = {};
    this.peersMap = {};
    this.hostId = null;
    this.isMigrating = false;
  }

  // --- MIGRATION HÔTE ---

  private handleHostLoss() {
    if (this.isMigrating) return;
    this.isMigrating = true;
    this.notify({ type: 'MIGRATION_START' });
    this.notify({ type: 'TOAST', msg: 'HÔTE PERDU - ÉLECTION...', level: 'error' });

    setTimeout(() => {
       const candidates = Object.values(this.peersMap).filter(p => p.id !== this.hostId);
       if (this.user) candidates.push(this.user);
       candidates.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
       
       const newHost = candidates[0];
       
       if (newHost && this.user && newHost.id === this.user.id) {
           this.promoteSelfToHost();
       } else if (newHost) {
           this.notify({ type: 'TOAST', msg: `NOUVEL HÔTE: ${newHost.callsign}`, level: 'info' });
           setTimeout(() => {
               this.connectToHost(newHost.id);
               this.isMigrating = false;
           }, 2000 + Math.random() * 1000);
       } else {
           this.cleanup();
           this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
       }
    }, 3000);
  }

  private promoteSelfToHost() {
    this.notify({ type: 'TOAST', msg: 'PRISE DE COMMANDEMENT', level: 'success' });
    const currentId = this.user?.id;
    const currentUser = this.user!;
    this.cleanup();
    setTimeout(() => {
        this.init(currentUser, OperatorRole.HOST, undefined, currentId);
        this.isMigrating = false;
        this.notify({ type: 'NEW_HOST_PROMOTED', hostId: currentId || '' });
    }, 1000);
  }

  private handleMigrationOrder() {
     this.promoteSelfToHost();
  }

  private generateShortId(): string {
    return Math.random().toString(36).substring(2, 10).toUpperCase();
  }
}

export const connectivityService = new ConnectivityService();
