import Peer, { DataConnection } from 'peerjs';
import { CONFIG } from '../constants';
import { UserData, OperatorRole, OperatorStatus } from '../types';

// Types d'événements
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

// CONFIGURATION ROBUSTE
const HEARTBEAT_INTERVAL = 2000; // Ping toutes les 2s
const HEARTBEAT_TIMEOUT = 6000;  // Mort si pas de réponse en 6s
const MAX_RETRY_ATTEMPTS = 99;   // Infini en pratique, on veut toujours réessayer

class ConnectivityService {
  private peer: Peer | null = null;
  private connections: Record<string, DataConnection> = {};
  private peersMap: Record<string, UserData> = {};
  private listeners: Listener[] = [];

  // État
  private user: UserData | null = null;
  private role: OperatorRole = OperatorRole.OPR;
  private hostId: string | null = null;     // ID de l'hôte actuel
  private targetHostId: string | null = null; // ID qu'on VEUT rejoindre (cible)
  
  // Gestion Résilience
  private heartbeatTimer: any = null;
  private lastSeen: Record<string, number> = {};
  private retryCount = 0;
  private isDestroying = false;
  private bannedPeers: Set<string> = new Set();

  // --- ABONNEMENTS ---
  public subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }

  private notify(event: ConnectivityEvent) {
    this.listeners.forEach(l => l(event));
  }

  // --- 1. INITIALISATION (HARD RESET) ---
  public async init(user: UserData, role: OperatorRole, targetHostId?: string, forceMyId?: string) {
    console.log(`[CONN] Init requested. Role: ${role}, Target: ${targetHostId}`);
    
    // Si on est déjà dans l'état désiré, on ne fait rien
    if (this.peer && !this.peer.destroyed && this.user?.role === role) {
        if (role === OperatorRole.HOST) return; // Déjà hôte
        if (role === OperatorRole.OPR && this.hostId === targetHostId && this.connections[targetHostId!]?.open) return; // Déjà connecté
    }

    this.user = { ...user, role };
    this.role = role;
    this.targetHostId = targetHostId || null;
    
    await this.hardReset(forceMyId);
  }

  // Détruit tout et recommence à zéro. La clé de la fiabilité.
  private async hardReset(forceId?: string) {
      if (this.isDestroying) return;
      this.isDestroying = true;

      // 1. Nettoyage complet
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      Object.values(this.connections).forEach(c => c.close());
      this.connections = {};
      this.lastSeen = {};
      
      if (this.peer) {
          this.peer.removeAllListeners();
          this.peer.destroy(); // Coupe le socket PeerServer
          this.peer = null;
      }

      this.isDestroying = false;

      // 2. Création nouvelle instance (Délai pour laisser le socket se libérer)
      setTimeout(() => this.createPeer(forceId), 500);
  }

  private createPeer(forceId?: string) {
      const myId = forceId || (this.role === OperatorRole.HOST ? this.generateShortId() : undefined);
      
      try {
          this.peer = new Peer(myId, CONFIG.PEER_CONFIG as any);
          this.bindPeerEvents();
      } catch (e) {
          console.error('[CONN] Peer Create Error:', e);
          this.retryConnection();
      }
  }

  // --- 2. ÉVÉNEMENTS PEERJS ---
  private bindPeerEvents() {
      if (!this.peer) return;

      this.peer.on('open', (id) => {
          console.log(`[CONN] Peer OPEN: ${id}`);
          this.retryCount = 0;
          if (this.user) this.user.id = id;
          this.notify({ type: 'PEER_OPEN', id });

          if (this.role === OperatorRole.HOST) {
              this.hostId = id;
              this.peersMap[id] = this.user!;
              this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
              this.notify({ type: 'TOAST', msg: `Session Ouverte: ${id}`, level: 'success' });
              this.startHeartbeat();
          } else if (this.targetHostId) {
              this.connectToPeer(this.targetHostId);
          }
      });

      this.peer.on('connection', (conn) => {
          if (this.bannedPeers.has(conn.peer)) {
              conn.close();
              return;
          }
          this.bindConnectionEvents(conn);
      });

      this.peer.on('error', (err: any) => {
          console.warn(`[CONN] Error: ${err.type}`);
          if (err.type === 'peer-unavailable') {
              // Cible introuvable
              if (this.role === OperatorRole.OPR) {
                  this.notify({ type: 'TOAST', msg: 'Hôte introuvable, nouvelle tentative...', level: 'warning' });
                  this.retryConnection();
              }
          } else if (err.type === 'unavailable-id') {
              // ID pris, on retry sans ID forcé ou on attend
              this.notify({ type: 'TOAST', msg: 'ID indisponible', level: 'error' });
          } else if (['network', 'disconnected', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
              // Erreur critique -> Hard Reset
              this.retryConnection();
          }
      });

      this.peer.on('disconnected', () => {
          console.log('[CONN] Peer Disconnected from signalling');
          // Important: Sur mobile, disconnected ne veut pas dire destroyed. 
          // Mais .reconnect() bug souvent. Mieux vaut reset.
          this.retryConnection();
      });
      
      this.peer.on('close', () => {
          console.log('[CONN] Peer Destroyed');
          // Si ce n'était pas volontaire, on relance
          if (!this.isDestroying) this.retryConnection();
      });
  }

  // --- 3. GESTION DES CONNEXIONS DE DONNÉES ---
  private connectToPeer(targetId: string) {
      if (!this.peer || this.peer.destroyed) return;
      
      console.log(`[CONN] Connecting to ${targetId}...`);
      const conn = this.peer.connect(targetId, {
          reliable: true,
          serialization: 'json', // OBLIGATOIRE POUR REACT NATIVE
      });
      this.bindConnectionEvents(conn);
  }

  private bindConnectionEvents(conn: DataConnection) {
      // Stockage connexion
      this.connections[conn.peer] = conn;
      this.lastSeen[conn.peer] = Date.now(); // On considère vivant au début

      conn.on('open', () => {
          console.log(`[CONN] Pipe OPEN with ${conn.peer}`);
          
          // Logique spécifique HOTE
          if (this.role === OperatorRole.HOST) {
              // On envoie tout de suite la liste des pairs pour que le nouveau voit tout le monde
              const peerList = Object.values(this.peersMap);
              conn.send({ type: 'SYNC', list: peerList });
          }
          
          // Logique spécifique CLIENT
          if (this.role === OperatorRole.OPR && conn.peer === this.targetHostId) {
              this.hostId = conn.peer;
              this.notify({ type: 'HOST_CONNECTED', hostId: this.hostId });
              this.retryCount = 0; // Succès !
              
              // On s'annonce
              conn.send({ type: 'FULL', user: this.user });
              
              // On démarre le heartbeat pour surveiller le lien
              this.startHeartbeat();
          }
      });

      conn.on('data', (data: any) => {
          this.lastSeen[conn.peer] = Date.now(); // Ping reçu
          
          if (data && data.type === 'HEARTBEAT') return; // Juste un ping
          
          this.handleData(data, conn.peer);
      });

      conn.on('close', () => {
          console.log(`[CONN] Pipe CLOSED with ${conn.peer}`);
          this.cleanupPeer(conn.peer);
      });

      conn.on('error', (err) => {
          console.warn(`[CONN] Pipe Error with ${conn.peer}`, err);
          conn.close(); // Force close pour trigger cleanup
      });
  }

  // --- 4. LOGIQUE MÉTIER & ROUTING ---
  private handleData(data: any, fromId: string) {
      if (this.bannedPeers.has(fromId)) return;

      this.notify({ type: 'DATA_RECEIVED', data, from: fromId });

      // Gestion interne des mises à jour de liste
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
              if (fromId === this.hostId) {
                  this.hardReset(); // On dégage proprement
                  this.notify({ type: 'DISCONNECTED', reason: 'KICKED' });
              }
              break;
      }
  }

  // --- 5. RÉSILIENCE (RETRY & HEARTBEAT) ---
  private retryConnection() {
      if (this.retryCount >= MAX_RETRY_ATTEMPTS) {
          this.notify({ type: 'DISCONNECTED', reason: 'NETWORK_ERROR' });
          return;
      }

      this.retryCount++;
      const delay = Math.min(1000 * this.retryCount, 10000); // Backoff linéaire plafonné à 10s
      
      console.log(`[CONN] Retrying in ${delay}ms...`);
      this.notify({ type: 'RECONNECTING', attempt: this.retryCount });
      
      setTimeout(() => this.hardReset(), delay);
  }

  private startHeartbeat() {
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      
      this.heartbeatTimer = setInterval(() => {
          const now = Date.now();

          // 1. Envoyer PING à tout le monde
          Object.values(this.connections).forEach(conn => {
              if (conn.open) conn.send({ type: 'HEARTBEAT' });
          });

          // 2. Vérifier qui est mort
          Object.keys(this.connections).forEach(peerId => {
              const last = this.lastSeen[peerId] || now;
              if (now - last > HEARTBEAT_TIMEOUT) {
                  console.warn(`[CONN] Timeout for ${peerId}`);
                  const conn = this.connections[peerId];
                  conn.close();
                  this.cleanupPeer(peerId);
                  
                  // Si c'est l'hôte qui est mort
                  if (peerId === this.hostId && this.role === OperatorRole.OPR) {
                      this.notify({ type: 'TOAST', msg: 'Lien Hôte perdu', level: 'error' });
                      this.notify({ type: 'DISCONNECTED', reason: 'NO_HOST' });
                      this.retryConnection(); // On tente de se reconnecter
                  }
              }
          });
      }, HEARTBEAT_INTERVAL);
  }

  private cleanupPeer(peerId: string) {
      delete this.connections[peerId];
      delete this.lastSeen[peerId];
      delete this.peersMap[peerId];
      this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
  }

  // --- 6. API PUBLIQUE ---
  public broadcast(data: any) {
      if (!this.user) return;
      const payload = { ...data, from: this.user.id };
      Object.values(this.connections).forEach(c => {
          if (c.open) c.send(payload);
      });
  }

  public sendTo(targetId: string, data: any) {
      if (!this.user) return;
      const conn = this.connections[targetId];
      if (conn && conn.open) conn.send({ ...data, from: this.user.id });
  }

  public updateUser(partial: Partial<UserData>) {
      if (!this.user) return;
      this.user = { ...this.user, ...partial };
      // Mise à jour locale
      if (this.user.id) this.peersMap[this.user.id] = this.user;
      this.notify({ type: 'PEERS_UPDATED', peers: this.peersMap });
      // Diffusion
      this.broadcast({ type: 'UPDATE_USER', user: this.user });
  }
  
  public updateUserStatus(status: OperatorStatus) {
      this.updateUser({ status });
  }
  
  public updateUserPosition(lat: number, lng: number, head: number) {
      // Optimisation: Pas de notify local pour le GPS pour éviter les re-renders inutiles
      if (!this.user) return;
      this.user = { ...this.user, lat, lng, head };
      if (this.user.id) this.peersMap[this.user.id] = this.user;
      this.broadcast({ type: 'UPDATE_USER', user: this.user });
  }

  public kickUser(targetId: string, ban = false) {
      if (this.role !== OperatorRole.HOST) return;
      this.sendTo(targetId, { type: 'KICK' });
      if (ban) this.bannedPeers.add(targetId);
      setTimeout(() => {
          if (this.connections[targetId]) this.connections[targetId].close();
      }, 200);
  }

  public cleanup() {
      this.hardReset();
  }

  private generateShortId(): string {
      return Math.random().toString(36).substring(2, 10).toUpperCase();
  }
}

export const connectivityService = new ConnectivityService();
