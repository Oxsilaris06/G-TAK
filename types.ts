export enum OperatorRole {
    HOST = 'HOST',
    OPR = 'OPR'
}

export enum OperatorStatus {
    CLEAR = 'CLEAR',
    CONTACT = 'CONTACT',
    PROGRESSION = 'PROGRESSION',
    BUSY = 'BUSY'
}

export interface UserData {
    id: string;
    callsign: string;
    role: OperatorRole;
    status: OperatorStatus;
    lat: number;
    lng: number;
    head: number;
    bat: number;
    joinedAt: number;
    lastMsg?: string;
    isTx?: boolean; 
}

export type PingType = 'HOSTILE' | 'FRIEND' | 'INTEL';

export interface HostileDetails {
    position?: string;   
    nature?: string;     
    attitude?: string;   
    volume?: string;     
    armes?: string;      
    substances?: string; 
}

export interface PingData {
    id: string;
    lat: number;
    lng: number;
    msg: string;
    type: PingType;
    details?: HostileDetails;
    sender: string;
    timestamp: number;
}

// --- NOUVEAU : TYPES POUR LA MAIN COURANTE ---
export interface LogEntry {
  id: string;
  heure: string;
  pax: string; // Nom ou type (ex: 'Alpha', 'Adversaire')
  paxColor: string; // Code hex pour le badge
  lieu: string;
  action: string; // Remplace "fenetrePorte" pour être plus générique
  remarques: string;
}

export interface AppSettings {
    username: string;
    gpsUpdateInterval: number;
    orientationUpdateInterval: number;
    userArrowColor: string;
    quickMessages: string[];
    disableBackgroundNotifications?: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
    username: '',
    gpsUpdateInterval: 2000,
    orientationUpdateInterval: 500,
    userArrowColor: '#3b82f6',
    quickMessages: [
        "RAS / Effacer",
        "Contact Visuel",
        "En Position",
        "Besoin Soutien",
        "Reçu",
        "Négatif",
        "Départ",
        "Halte"
    ],
    disableBackgroundNotifications: false
};

export type ViewType = 'login' | 'menu' | 'ops' | 'map' | 'settings' | 'logs'; // Ajout de 'logs'
