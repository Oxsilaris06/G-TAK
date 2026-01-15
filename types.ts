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
    lastMsg?: string;      // Nouveau champ pour le message rapide
}

export type PingType = 'HOSTILE' | 'FRIEND' | 'INTEL';

// Structure détaillée pour le caneva Hostile (SALTA / format tactique)
export interface HostileDetails {
    position?: string;   
    nature?: string;     
    attitude?: string;   
    volume?: string;     
    armes?: string;      
    substances?: string; // Tenue / Signes distinctifs
}

export interface PingData {
    id: string;
    lat: number;
    lng: number;
    msg: string;         // Texte principal
    type: PingType;
    details?: HostileDetails; // Détails optionnels (Hostile)
    sender: string;
    timestamp: number;
}

export interface AppSettings {
    username: string;
    gpsUpdateInterval: number;
    userArrowColor: string;
    quickMessages: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
    username: '',
    gpsUpdateInterval: 2000,
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
    ]
};

export type ViewType = 'login' | 'menu' | 'ops' | 'map' | 'settings';
