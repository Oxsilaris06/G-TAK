import defaultMessages from './msg.json';

export enum OperatorRole {
  HOST = 'HOST',
  OPR = 'OPR',
}

export enum OperatorStatus {
  CLEAR = 'CLEAR',
  CONTACT = 'CONTACT',
  BUSY = 'BUSY',
  APPUI = 'APPUI',
  PROGRESSION = 'PROGRESSION',
}

export type ViewType = 'login' | 'menu' | 'ops' | 'map' | 'settings';

export interface UserData {
  id: string;
  callsign: string;
  role: OperatorRole;
  status: OperatorStatus;
  isTx: boolean;
  lat: number;
  lng: number;
  head: number;
  bat: number | null;
  joinedAt: number;
  lastMsg?: string; // Message rapide affiché sur la tuile
}

export interface PingData {
  id: string;
  lat: number;
  lng: number;
  msg: string;
  sender: string;
  timestamp: number;
}

// --- CONFIGURATION ---
export interface AppSettings {
  username: string;
  audioOutput: 'defaut' | 'casque' | 'hp';
  gpsUpdateInterval: number; // 2000, 5000, 10000, 60000
  pttKey: number;
  userArrowColor: string; // Couleur Hex
  theme: 'dark' | 'light';
  voxSensitivity: number; // 0 (Peu sensible/Dur) à 100 (Très sensible)
  quickMessages: string[]; // Liste des messages rapides
}

export const DEFAULT_SETTINGS: AppSettings = {
  username: 'OPR',
  audioOutput: 'defaut',
  gpsUpdateInterval: 5000, // 5 sec par défaut
  pttKey: 24,
  userArrowColor: '#3b82f6', // Bleu Tactique par défaut
  theme: 'dark',
  voxSensitivity: 50, // 50% par défaut
  quickMessages: defaultMessages // Chargement depuis le JSON
};
