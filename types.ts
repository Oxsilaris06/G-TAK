export enum OperatorRole {
  HOST = 'HOST',
  OPR = 'OPR'
}

export enum OperatorStatus {
  CLEAR = 'CLEAR',
  CONTACT = 'CONTACT',
  BUSY = 'BUSY',
  PROGRESSION = 'PROGRESSION'
}

export type ViewType = 'login' | 'menu' | 'map' | 'ops' | 'settings';
export type PingType = 'HOSTILE' | 'FRIEND' | 'INTEL';

export interface HostileDetails {
    position: string;
    nature: string;
    attitude: string;
    volume: string;
    armes: string;
    substances: string;
}

export interface UserData {
  id: string;
  callsign: string;
  role: OperatorRole;
  status: OperatorStatus;
  joinedAt: number;
  bat: number;
  lat: number;
  lng: number;
  head: number;
  lastMsg: string;
  paxColor?: string; // Couleur personnalisée
}

export interface PingData {
  id: string;
  lat: number;
  lng: number;
  msg: string;
  type: PingType;
  sender: string;
  timestamp: number;
  details?: HostileDetails;
}

export interface LogEntry {
    id: string;
    timestamp: number;
    pax: string; // trigramme
    category: string; // ex: 'CONTACT', 'RAS'
    action: string;
    lieu?: string;
    remarques?: string;
}

export interface AppSettings {
  username: string;
  gpsUpdateInterval: number; // ms
  orientationUpdateInterval: number; // ms
  userArrowColor: string;
  customMapUrl?: string; // file:// ou http://
  quickMessages: string[];
  disableBackgroundNotifications: boolean;
  maxTrailsPerUser: number; // Nouveau paramètre
}

export const DEFAULT_SETTINGS: AppSettings = {
  username: '',
  gpsUpdateInterval: 5000,
  orientationUpdateInterval: 500,
  userArrowColor: '#3b82f6',
  quickMessages: [
      "RAS / Effacer", "En Position", "Départ", "Halte", 
      "Visuel", "Contact", "Reçu", "Demande Radio"
  ],
  disableBackgroundNotifications: false,
  maxTrailsPerUser: 500
};
