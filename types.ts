/**
 * Types globaux de l'application Praxis
 */

export enum OperatorRole {
  HOST = 'HOST',
  OPR = 'OPR',
}

export enum OperatorStatus {
  CLEAR = 'CLEAR',
  CONTACT = 'CONTACT',
  BUSY = 'BUSY',
  PROGRESSION = 'PROGRESSION',
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
  paxColor?: string;
  _networkId?: string;
  connectionTimestamp?: number; // Timestamp pour l'élection du nouvel hôte
  isBackground?: boolean;
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
  image?: string | null; // Legacy Base64 (Optional)
  imageUri?: string | null; // Local File URI
  imageId?: string | null; // Network ID for P2P transfer
  hasImage?: boolean; // Flag to indicate image availability
}

export interface LogEntry {
  id: string;
  timestamp: number;
  heure: string;
  pax: string;
  paxColor: string;
  category: string;
  action: string;
  lieu?: string;
  remarques?: string;
}

export interface AppSettings {
  username: string;
  gpsUpdateInterval: number;
  orientationUpdateInterval: number;
  heartbeatInterval: number; // Intervalle heartbeat en ms (5000-120000)
  userArrowColor: string;
  customMapUrl?: string;
  quickMessages: string[];
  disableBackgroundNotifications: boolean;
  maxTrailsPerUser: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  username: '',
  gpsUpdateInterval: 5000,
  orientationUpdateInterval: 500,
  heartbeatInterval: 10000, // 10 secondes par défaut
  userArrowColor: '#3b82f6',
  quickMessages: [
    'RAS / Effacer',
    'En Position',
    'Départ',
    'Halte',
    'Visuel',
    'Contact',
    'Reçu',
    'Demande Radio',
  ],
  disableBackgroundNotifications: false,
  maxTrailsPerUser: 500,
};
