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
    paxColor?: string; // NOUVEAU: Couleur perso choisie
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

export interface LogEntry {
  id: string;
  heure: string;
  pax: string;       
  paxColor: string;  
  lieu: string;
  action: string;    
  remarques: string;
}

export interface AppSettings {
    username: string;
    gpsUpdateInterval: number;
    orientationUpdateInterval: number;
    userArrowColor: string; // Stocke la couleur perso (Cyan, Rose etc)
    quickMessages: string[];
    disableBackgroundNotifications?: boolean;
    customMapUrl?: string; // NOUVEAU: Pour charger une source locale/custom
}

export const DEFAULT_SETTINGS: AppSettings = {
    username: '',
    gpsUpdateInterval: 2000,
    orientationUpdateInterval: 500,
    userArrowColor: '#06b6d4', // Cyan par défaut
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

export type ViewType = 'login' | 'menu' | 'ops' | 'map' | 'settings' | 'logs';
