/**
 * Constantes de l'application Praxis
 */

import { OperatorStatus } from './types';

export const CONFIG = {
  // Clés de stockage MMKV
  SESSION_STORAGE_KEY: 'praxis_v2_session',
  TRIGRAM_STORAGE_KEY: 'praxis_v2_trigram',
  SETTINGS_KEY: 'praxis_v2_settings',
  CONSENT_KEY: 'praxis_v2_privacy_consent',

  // Configuration PeerJS optimisée
  PEER_CONFIG: {
    secure: true,
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    debug: 1,
    config: {
      iceCandidatePoolSize: 0,
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['stun:stun.l.google.com:53'] },
        { urls: ['stun:stun.l.google.com:443'] },
        { urls: ['stun:global.stun.twilio.com:3478'] },
        { urls: ['stun:stun.stunprotocol.org:3478'] },
      ],
    },
    pingInterval: 10000,
  },

  // Limites et timeouts
  MAX_RECONNECT_ATTEMPTS: 5,
  HEARTBEAT_INTERVAL: 10000,
  GPS_UPDATE_INTERVAL: 5000,
  ORIENTATION_UPDATE_INTERVAL: 100,
  MAX_TRAILS_PER_USER: 500,
  MAX_IMAGE_SIZE: 800,
  IMAGE_COMPRESSION: 0.43,

  // Couleurs tactiques
  COLORS: {
    primary: '#3b82f6',
    success: '#22c55e',
    danger: '#ef4444',
    warning: '#eab308',
    info: '#06b6d4',
    nightOps: '#ef4444',
    nightOpsBorder: '#7f1d1d',
    background: '#050505',
    surface: '#18181b',
    border: '#27272a',
    text: '#f4f4f5',
    textMuted: '#71717a',
  },
};

export const STATUS_COLORS = {
  [OperatorStatus.CLEAR]: '#22c55e',
  [OperatorStatus.CONTACT]: '#ef4444',
  [OperatorStatus.BUSY]: '#a855f7',
  [OperatorStatus.PROGRESSION]: '#3b82f6',
};

export const PING_TYPE_COLORS = {
  HOSTILE: { bg: '#450a0a', border: '#ef4444', text: '#ef4444' },
  FRIEND: { bg: '#052e16', border: '#22c55e', text: '#22c55e' },
  INTEL: { bg: '#422006', border: '#eab308', text: '#eab308' },
};

export const MAP_STYLES = {
  dark: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  hybrid: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};

export const QUICK_MESSAGES_DEFAULT = [
  'RAS / Effacer',
  'En Position',
  'Départ',
  'Halte',
  'Visuel',
  'Contact',
  'Reçu',
  'Demande Radio',
];

export const PAX_TYPES = [
  { label: 'HOSTILE', color: '#be1b09', textColor: '#ffffff' },
  { label: 'CIVIL/OTAGE', color: '#f1c40f', textColor: '#000000' },
  { label: 'INTER', color: '#3498db', textColor: '#ffffff' },
  { label: 'ALLIÉ', color: '#22c55e', textColor: '#000000' },
  { label: 'AUTRE', color: '#9ca3af', textColor: '#000000' },
];
