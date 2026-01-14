export enum OperatorRole {
    HOST = 'HOST',
    OPR = 'OPR'
}

export enum OperatorStatus {
    CLEAR = 'CLEAR',
    CONTACT = 'CONTACT',
    PROGRESSION = 'PROGRESSION',
    BUSY = 'BUSY' // Remplacé "En Ligne" par Busy générique
}

export interface UserData {
    id: string;
    callsign: string;
    role: OperatorRole;
    status: OperatorStatus;
    
    // Position & Capteurs
    lat: number;
    lng: number;
    head: number; // Cap (Heading) 0-360
    bat: number; // Batterie %
    
    // États
    joinedAt: number;
    lastMsg?: string; // Dernier message rapide envoyé
    
    // isTx: boolean; // SUPPRIMÉ (Plus de transmission audio)
}

export interface PingData {
    id: string;
    lat: number;
    lng: number;
    msg: string;
    sender: string;
    timestamp: number;
}

export interface AppSettings {
    username: string;
    gpsUpdateInterval: number; // en ms
    userArrowColor: string;
    quickMessages: string[];
    // audioOutput: 'hp' | 'casque'; // SUPPRIMÉ
    // voxSensitivity: number; // SUPPRIMÉ
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
        "Reçu 5/5",
        "Départ Mission"
    ]
};

export type ViewType = 'login' | 'menu' | 'ops' | 'map' | 'settings';
