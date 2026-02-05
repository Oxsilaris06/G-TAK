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
  image?: string | null;
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
