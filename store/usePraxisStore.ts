/**
 * Store Zustand - Gestion d'État Globale
 * Remplace les useState complexes par un store performant et persistant
 * 
 * Avantages:
 * - Pas de re-rendus inutiles (sélecteurs optimisés)
 * - Persistance automatique avec MMKV
 * - Actions centralisées
 * - DevTools integration
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import {
  UserData,
  OperatorStatus,
  OperatorRole,
  PingData,
  LogEntry,
  AppSettings,
  DEFAULT_SETTINGS,
  ViewType,
} from '../types';
import { mmkvAsyncStorageCompat } from '../services/mmkvStorage';

// État du réseau P2P
interface NetworkState {
  hostId: string;
  peers: Record<string, UserData>;
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
}

// État de la carte
interface MapState {
  center: { lat: number; lng: number } | null;
  zoom: number;
  mode: 'dark' | 'light' | 'satellite' | 'hybrid' | 'custom';
  showTrails: boolean;
  showPings: boolean;
  isPingMode: boolean;
  navTargetId: string | null;
  navMode: 'pedestrian' | 'vehicle';
  navInfo: { dist: string; time: string } | null;
}

// Notification Type
type NotificationType = 'alert' | 'info' | 'success' | 'warning';

// État UI
interface UIState {
  view: ViewType | 'oi';
  lastView: ViewType;
  lastOpsView: ViewType;
  showSettings: boolean;
  showLogs: boolean;
  showQRModal: boolean;
  showScanner: boolean;
  showQuickMsgModal: boolean;
  showPingMenu: boolean;
  showPingForm: boolean;
  nightOpsMode: boolean;
  selectedOperatorId: string | null;
  activeNotification: { id: string; msg: string; type: NotificationType } | null;
}

// État des pings
interface PingState {
  pings: PingData[];
  editingPing: PingData | null;
  tempPingLoc: { lat: number; lng: number } | null;
  currentPingType: 'HOSTILE' | 'FRIEND' | 'INTEL';
  pingMsgInput: string;
  tempImage: string | null;
  fullScreenImage: string | null;
}

// État des logs
interface LogState {
  logs: LogEntry[];
}

// État des messages
interface MessageState {
  quickMessages: string[];
  freeMsgInput: string;
  lastMsg: string;
}

// Interface complète du store
interface PraxisState {
  // App State
  isAppReady: boolean;
  settings: AppSettings;

  // User
  user: UserData;

  // Network
  network: NetworkState;

  // Map
  map: MapState;

  // UI
  ui: UIState;

  // Pings
  ping: PingState;

  // Logs
  log: LogState;

  // Messages
  message: MessageState;

  // Actions
  actions: {
    // App
    setAppReady: (ready: boolean) => void;

    // Settings
    updateSettings: (settings: Partial<AppSettings>) => void;
    resetSettings: () => void;

    // User
    setUser: (user: Partial<UserData>) => void;
    updateUser: (user: Partial<UserData>) => void; // Alias for setUser (used in App.tsx)
    setUserStatus: (status: OperatorStatus) => void;
    setUserPosition: (lat: number, lng: number, head?: number) => void;
    setUserBattery: (bat: number) => void;
    setUserMessage: (msg: string) => void;
    resetUser: () => void;

    // Network
    setHostId: (id: string) => void;
    setPeers: (peers: Record<string, UserData>) => void;
    updatePeer: (id: string, data: Partial<UserData>) => void;
    removePeer: (id: string) => void;
    setNetworkStatus: (status: Partial<NetworkState>) => void;
    resetNetwork: () => void;

    // Map
    setMapCenter: (center: { lat: number; lng: number } | null) => void;
    setMapZoom: (zoom: number) => void;
    setMapMode: (mode: MapState['mode']) => void;
    toggleTrails: () => void;
    togglePings: () => void;
    togglePingMode: () => void;
    setNavTarget: (id: string | null) => void;
    setNavMode: (mode: 'pedestrian' | 'vehicle') => void;
    setNavInfo: (info: { dist: string; time: string } | null) => void;

    // UI
    setView: (view: ViewType | 'oi') => void;
    goBack: () => void;
    toggleSettings: () => void;
    toggleLogs: () => void;
    toggleNightOps: () => void;
    showNotification: (msg: string, type: NotificationType) => void;
    dismissNotification: () => void;
    setSelectedOperator: (id: string | null) => void;
    toggleQRModal: () => void;
    toggleScanner: () => void;
    toggleQuickMsgModal: () => void;
    togglePingMenu: () => void;
    togglePingForm: () => void;

    // Pings
    addPing: (ping: PingData) => void;
    updatePing: (id: string, updates: Partial<PingData>) => void;
    movePing: (id: string, lat: number, lng: number) => void;
    deletePing: (id: string) => void;
    setEditingPing: (ping: PingData | null) => void;
    setTempPingLoc: (loc: { lat: number; lng: number } | null) => void;
    setCurrentPingType: (type: PingState['currentPingType']) => void;
    setPingMsgInput: (msg: string) => void;
    setTempImage: (image: string | null) => void;
    setFullScreenImage: (image: string | null) => void;
    resetPings: () => void;

    // Logs
    addLog: (entry: LogEntry) => void;
    updateLog: (entry: LogEntry) => void;
    deleteLog: (id: string) => void;
    resetLogs: () => void;

    // Messages
    addQuickMessage: (msg: string) => void;
    removeQuickMessage: (index: number) => void;
    setQuickMessages: (msgs: string[]) => void;
    setFreeMsgInput: (msg: string) => void;

    // Global Reset
    resetAll: () => void;
  };
}

// État initial
const initialUser: UserData = {
  id: '',
  callsign: '',
  role: OperatorRole.OPR,
  status: OperatorStatus.CLEAR,
  joinedAt: Date.now(),
  bat: 100,
  head: 0,
  lat: 0,
  lng: 0,
  lastMsg: '',
};

const initialNetwork: NetworkState = {
  hostId: '',
  peers: {},
  isConnected: false,
  isReconnecting: false,
  reconnectAttempt: 0,
};

const initialMap: MapState = {
  center: null,
  zoom: 15,
  mode: 'satellite',
  showTrails: true,
  showPings: true,
  isPingMode: false,
  navTargetId: null,
  navMode: 'pedestrian',
  navInfo: null,
};

const initialUI: UIState = {
  view: 'login',
  lastView: 'menu',
  lastOpsView: 'map',
  showSettings: false,
  showLogs: false,
  showQRModal: false,
  showScanner: false,
  showQuickMsgModal: false,
  showPingMenu: false,
  showPingForm: false,
  nightOpsMode: false,
  selectedOperatorId: null,
  activeNotification: null,
};

const initialPing: PingState = {
  pings: [],
  editingPing: null,
  tempPingLoc: null,
  currentPingType: 'FRIEND',
  pingMsgInput: '',
  tempImage: null,
  fullScreenImage: null,
};

const initialLog: LogState = {
  logs: [],
};

const initialMessage: MessageState = {
  quickMessages: DEFAULT_SETTINGS.quickMessages,
  freeMsgInput: '',
  lastMsg: '',
};

// Création du store avec middleware
export const usePraxisStore = create<PraxisState>()(
  immer(
    persist(
      (set, get) => ({
        // État initial
        isAppReady: false,
        settings: DEFAULT_SETTINGS,
        user: initialUser,
        network: initialNetwork,
        map: initialMap,
        ui: initialUI,
        ping: initialPing,
        log: initialLog,
        message: initialMessage,

        // Actions
        actions: {
          // App
          setAppReady: (ready) =>
            set((state) => {
              state.isAppReady = ready;
            }),

          // Settings
          updateSettings: (newSettings: Partial<AppSettings>) =>
            set((state: PraxisState) => {
              state.settings = { ...state.settings, ...newSettings };
            }),
          resetSettings: () =>
            set((state) => {
              state.settings = DEFAULT_SETTINGS;
            }),

          // User
          setUser: (userData: Partial<UserData>) =>
            set((state: PraxisState) => {
              state.user = { ...state.user, ...userData };
            }),
          // Alias for setUser (used in App.tsx)
          updateUser: (userData: Partial<UserData>) =>
            set((state: PraxisState) => {
              state.user = { ...state.user, ...userData };
            }),
          setUserStatus: (status) =>
            set((state) => {
              state.user.status = status;
            }),
          setUserPosition: (lat, lng, head) =>
            set((state) => {
              state.user.lat = lat;
              state.user.lng = lng;
              if (head !== undefined) state.user.head = head;
            }),
          setUserBattery: (bat) =>
            set((state) => {
              state.user.bat = bat;
            }),
          setUserMessage: (msg) =>
            set((state) => {
              state.user.lastMsg = msg;
              state.message.lastMsg = msg;
            }),
          resetUser: () =>
            set((state) => {
              state.user = { ...initialUser, paxColor: state.settings.userArrowColor };
            }),

          // Network
          setHostId: (id) =>
            set((state) => {
              state.network.hostId = id;
            }),
          setPeers: (peers) =>
            set((state) => {
              state.network.peers = peers;
            }),
          updatePeer: (id, data) =>
            set((state) => {
              if (state.network.peers[id]) {
                state.network.peers[id] = { ...state.network.peers[id], ...data };
              }
            }),
          removePeer: (id) =>
            set((state) => {
              delete state.network.peers[id];
            }),
          setNetworkStatus: (status) =>
            set((state) => {
              state.network = { ...state.network, ...status };
            }),
          resetNetwork: () =>
            set((state) => {
              state.network = initialNetwork;
            }),

          // Map
          setMapCenter: (center) =>
            set((state) => {
              state.map.center = center;
            }),
          setMapZoom: (zoom) =>
            set((state) => {
              state.map.zoom = zoom;
            }),
          setMapMode: (mode) =>
            set((state) => {
              state.map.mode = mode;
            }),
          toggleTrails: () =>
            set((state) => {
              state.map.showTrails = !state.map.showTrails;
            }),
          togglePings: () =>
            set((state) => {
              state.map.showPings = !state.map.showPings;
            }),
          togglePingMode: () =>
            set((state) => {
              state.map.isPingMode = !state.map.isPingMode;
            }),
          setNavTarget: (id) =>
            set((state) => {
              state.map.navTargetId = id;
              if (!id) state.map.navInfo = null;
            }),
          setNavMode: (mode) =>
            set((state) => {
              state.map.navMode = mode;
            }),
          setNavInfo: (info) =>
            set((state) => {
              state.map.navInfo = info;
            }),

          // UI
          setView: (view) =>
            set((state) => {
              if (state.ui.view === 'map' || state.ui.view === 'ops') {
                state.ui.lastOpsView = state.ui.view;
              }
              if (view !== 'settings') {
                state.ui.lastView = state.ui.view;
              }
              state.ui.view = view;
            }),
          goBack: () =>
            set((state) => {
              state.ui.view = state.ui.lastView;
            }),
          toggleSettings: () =>
            set((state) => {
              state.ui.showSettings = !state.ui.showSettings;
            }),
          toggleLogs: () =>
            set((state) => {
              state.ui.showLogs = !state.ui.showLogs;
            }),
          toggleNightOps: () =>
            set((state) => {
              state.ui.nightOpsMode = !state.ui.nightOpsMode;
            }),
          showNotification: (msg, type) =>
            set((state) => {
              state.ui.activeNotification = {
                id: Date.now().toString(),
                msg,
                type,
              };
            }),
          dismissNotification: () =>
            set((state) => {
              state.ui.activeNotification = null;
            }),
          setSelectedOperator: (id) =>
            set((state) => {
              state.ui.selectedOperatorId = id;
            }),
          toggleQRModal: () =>
            set((state) => {
              state.ui.showQRModal = !state.ui.showQRModal;
            }),
          toggleScanner: () =>
            set((state) => {
              state.ui.showScanner = !state.ui.showScanner;
            }),
          toggleQuickMsgModal: () =>
            set((state) => {
              state.ui.showQuickMsgModal = !state.ui.showQuickMsgModal;
            }),
          togglePingMenu: () =>
            set((state) => {
              state.ui.showPingMenu = !state.ui.showPingMenu;
            }),
          togglePingForm: () =>
            set((state) => {
              state.ui.showPingForm = !state.ui.showPingForm;
            }),

          // Pings
          addPing: (ping) =>
            set((state) => {
              state.ping.pings.push(ping);
            }),
          updatePing: (id, updates) =>
            set((state) => {
              const idx = state.ping.pings.findIndex((p) => p.id === id);
              if (idx !== -1) {
                state.ping.pings[idx] = { ...state.ping.pings[idx], ...updates };
              }
            }),
          movePing: (id, lat, lng) =>
            set((state) => {
              const idx = state.ping.pings.findIndex((p) => p.id === id);
              if (idx !== -1) {
                state.ping.pings[idx].lat = lat;
                state.ping.pings[idx].lng = lng;
              }
            }),
          deletePing: (id) =>
            set((state) => {
              state.ping.pings = state.ping.pings.filter((p) => p.id !== id);
            }),
          setEditingPing: (ping) =>
            set((state) => {
              state.ping.editingPing = ping;
              if (ping) {
                state.ping.pingMsgInput = ping.msg;
              }
            }),
          setTempPingLoc: (loc) =>
            set((state) => {
              state.ping.tempPingLoc = loc;
            }),
          setCurrentPingType: (type) =>
            set((state) => {
              state.ping.currentPingType = type;
            }),
          setPingMsgInput: (msg) =>
            set((state) => {
              state.ping.pingMsgInput = msg;
            }),
          setTempImage: (image) =>
            set((state) => {
              state.ping.tempImage = image;
            }),
          setFullScreenImage: (image) =>
            set((state) => {
              state.ping.fullScreenImage = image;
            }),
          resetPings: () =>
            set((state) => {
              state.ping = initialPing;
            }),

          // Logs
          addLog: (entry) =>
            set((state) => {
              state.log.logs.push(entry);
            }),
          updateLog: (entry) =>
            set((state) => {
              const idx = state.log.logs.findIndex((l) => l.id === entry.id);
              if (idx !== -1) {
                state.log.logs[idx] = entry;
              }
            }),
          deleteLog: (id) =>
            set((state) => {
              state.log.logs = state.log.logs.filter((l) => l.id !== id);
            }),
          resetLogs: () =>
            set((state) => {
              state.log.logs = [];
            }),

          // Messages
          addQuickMessage: (msg) =>
            set((state) => {
              state.message.quickMessages.push(msg);
              state.settings.quickMessages = state.message.quickMessages;
            }),
          removeQuickMessage: (index) =>
            set((state) => {
              state.message.quickMessages.splice(index, 1);
              state.settings.quickMessages = state.message.quickMessages;
            }),
          setQuickMessages: (msgs) =>
            set((state) => {
              state.message.quickMessages = msgs;
              state.settings.quickMessages = msgs;
            }),
          setFreeMsgInput: (msg) =>
            set((state) => {
              state.message.freeMsgInput = msg;
            }),

          // Global Reset
          resetAll: () =>
            set((state) => {
              state.user = { ...initialUser, paxColor: state.settings.userArrowColor };
              state.network = initialNetwork;
              state.map = initialMap;
              state.ui = initialUI;
              state.ping = initialPing;
              state.log = initialLog;
              state.message = initialMessage;
            }),
        },
      }),
      {
        name: 'praxis-store',
        storage: createJSONStorage(() => mmkvAsyncStorageCompat),
        partialize: (state) => ({
          // Ne persister que les données nécessaires
          settings: state.settings,
          message: {
            quickMessages: state.message.quickMessages,
          },
        }),
      }
    )
  )
);

// Sélecteurs optimisés pour éviter les re-rendus
export const useUser = () => usePraxisStore((state) => state.user);
export const useNetwork = () => usePraxisStore((state) => state.network);
export const useMapState = () => usePraxisStore((state) => state.map);
export const useUI = () => usePraxisStore((state) => state.ui);
export const usePings = () => usePraxisStore((state) => state.ping);
export const useLogs = () => usePraxisStore((state) => state.log);
export const useSettings = () => usePraxisStore((state) => state.settings);
export const useActions = () => usePraxisStore((state) => state.actions);

export default usePraxisStore;
