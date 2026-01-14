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
}

export type PingType = 'HOSTILE' | 'FRIEND' | 'INTEL';

export interface HostileDetails {
    attitude?: string;
    volume?: string;
    armes?: string;
    substances?: string;
}

export interface PingData {
    id: string;
    lat: number;
    lng: number;
    msg: string;         // Texte libre (affiché au dessus)
    type: PingType;      // Type de ping
    details?: HostileDetails; // Infos caneva (pour hostile)
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
        "Besoin Soutien"
    ]
};

export type ViewType = 'login' | 'menu' | 'ops' | 'map' | 'settings';
