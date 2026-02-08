import './polyfills';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useFonts, SairaStencilOne_400Regular } from '@expo-google-fonts/saira-stencil-one';
import {
    StyleSheet, View, Text, TextInput, TouchableOpacity,
    SafeAreaView, Platform, Modal, StatusBar as RNStatusBar, Alert, ScrollView, ActivityIndicator,
    KeyboardAvoidingView, AppState, FlatList, useWindowDimensions, Dimensions, Image
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import QRCode from 'react-native-qrcode-svg';
import { Camera, CameraView } from 'expo-camera';
import * as Notifications from 'expo-notifications';
import { useKeepAwake } from 'expo-keep-awake';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import * as Battery from 'expo-battery';

import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

import { UserData, OperatorStatus, OperatorRole, ViewType, PingData, AppSettings, DEFAULT_SETTINGS, PingType, HostileDetails, LogEntry } from './types';
import { CONFIG, STATUS_COLORS } from './constants';
import { configService } from './services/configService';
import { connectivityService, ConnectivityEvent } from './services/connectivityService';
import { locationService } from './services/locationService';
import { permissionService } from './services/permissionService';

import { mmkvStorage } from './services/mmkvStorage';
import { imageService } from './services/imageService';

import UpdateNotifier from './components/UpdateNotifier';
import OperatorCard from './components/OperatorCard';
import TacticalMap from './components/TacticalMap';
import SettingsView from './components/SettingsView';
import OperatorActionModal from './components/OperatorActionModal';
import MainCouranteView from './components/MainCouranteView';
import PrivacyConsentModal from './components/PrivacyConsentModal';
import { NotificationToast } from './components/NotificationToast';
import ComposantOrdreInitial from './components/ComposantOrdreInitial';
import TacticalBackground from './components/TacticalBackground';
import SecureBootView from './components/SecureBootView';
import { usePraxisStore } from './store/usePraxisStore';

try { SplashScreen.preventAutoHideAsync().catch(() => { }); } catch (e) { }

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false,
    }),
});

const App: React.FC = () => {
    useKeepAwake();
    const { width, height } = useWindowDimensions();
    const isLandscape = width > height;



    // SECURE BOOT STATE
    const [isStoreReady, setIsStoreReady] = useState(false);

    const [isAppReady, setIsAppReady] = useState(false);
    const [fontsLoaded] = useFonts({ 'Saira Stencil One': SairaStencilOne_400Regular });
    const [activeNotif, setActiveNotif] = useState<{ id: string, msg: string, type: 'alert' | 'info' | 'success' | 'warning' } | null>(null);
    const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

    const [user, setUser] = useState<UserData>({
        id: 'loading...', // ID Persistant en cours de chargement
        callsign: '', role: OperatorRole.OPR, status: OperatorStatus.CLEAR,
        joinedAt: Date.now(), bat: 100, head: 0, lat: 0, lng: 0, lastMsg: ''
    });

    const [view, setView] = useState<ViewType | 'oi'>('login');
    const [lastView, setLastView] = useState<ViewType>('menu');
    const [lastOpsView, setLastOpsView] = useState<ViewType>('map');
    const [mapState, setMapState] = useState<{ lat: number, lng: number, zoom: number } | undefined>(undefined);
    const [showSettings, setShowSettings] = useState(false);

    const [peers, setPeers] = useState<Record<string, UserData>>({});
    const [pings, setPings] = useState<PingData[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [hostId, setHostId] = useState<string>('');

    const pingsRef = useRef(pings);
    const logsRef = useRef(logs);
    const peersRef = useRef(peers);
    const userRef = useRef(user);

    // const magSubscription = useRef<any>(null); // Removed: Managed by LocationService
    const lastSentHead = useRef<number>(0);


    // Prevention double scan
    const [scanned, setScanned] = useState(false);

    useEffect(() => { pingsRef.current = pings; }, [pings]);
    useEffect(() => { logsRef.current = logs; }, [logs]);
    useEffect(() => { peersRef.current = peers; }, [peers]);
    useEffect(() => { userRef.current = user; }, [user]);

    const [loginInput, setLoginInput] = useState('');
    const [hostInput, setHostInput] = useState('');
    const [mapMode, setMapMode] = useState<'dark' | 'light' | 'satellite' | 'hybrid' | 'custom'>('satellite');
    const [showTrails, setShowTrails] = useState(true);
    const [showPings, setShowPings] = useState(true);
    const [isPingMode, setIsPingMode] = useState(false);
    const [nightOpsMode, setNightOpsMode] = useState(false);
    const [showLogs, setShowLogs] = useState(false);

    const [showQRModal, setShowQRModal] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [showQuickMsgModal, setShowQuickMsgModal] = useState(false);
    const [showPingMenu, setShowPingMenu] = useState(false);
    const [showPingForm, setShowPingForm] = useState(false);

    useEffect(() => {
        if (tempImage) console.log('[App] tempImage is currently:', tempImage);
    }, [tempImage]);

    // Sync tempImage triggered manually in onPingClick now to avoid race conditions.
    // useEffect removed.

    // Reference pour accès dans les callbacks sans dépendance
    const [freeMsgInput, setFreeMsgInput] = useState('');
    const [quickMessagesList, setQuickMessagesList] = useState<string[]>([]);
    const [tempPingLoc, setTempPingLoc] = useState<any>(null);
    const [currentPingType, setCurrentPingType] = useState<PingType>('FRIEND');
    const [pingMsgInput, setPingMsgInput] = useState('');
    const [hostileDetails, setHostileDetails] = useState<HostileDetails>({ position: '', nature: '', attitude: '', volume: '', armes: '', substances: '' });

    // Gestion de l'image (création/édition/visualisation)
    const [tempImage, setTempImage] = useState<string | null>(null);
    const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);

    const [editingPing, setEditingPing] = useState<PingData | null>(null);

    const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null);
    const [navTargetId, setNavTargetId] = useState<string | null>(null);
    const [navInfo, setNavInfo] = useState<{ dist: string, time: string } | null>(null);
    const [navMode, setNavMode] = useState<'pedestrian' | 'vehicle'>('pedestrian');

    const [gpsStatus, setGpsStatus] = useState<'WAITING' | 'OK' | 'ERROR'>('WAITING');

    const showToast = useCallback((msg: string, type: 'info' | 'error' | 'success' | 'warning' = 'info') => {
        // MAPPING: NotificationToast uses 'alert' for red, but app uses 'error'.
        const notifType = type === 'error' ? 'alert' : type;

        setActiveNotif({ id: Date.now().toString(), msg, type: notifType });
        if (type === 'error' || type === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        else if (type === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }, []);

    const triggerTacticalNotification = async (title: string, body: string) => {
        if (AppState.currentState !== 'background' || settings.disableBackgroundNotifications) return;
        await Notifications.dismissAllNotificationsAsync();
        await Notifications.scheduleNotificationAsync({
            content: {
                title,
                body,
                sound: true,
                priority: Notifications.AndroidNotificationPriority.HIGH,
                color: "#000000"
            },
            trigger: null,
        });
    };

    const safeBroadcast = async (data: any, critical: boolean = false) => {
        try {
            if (critical && connectivityService.broadcastWithAck) {
                await connectivityService.broadcastWithAck(data);
            } else {
                connectivityService.broadcast(data);
            }
        } catch (e) {
            console.error('[App] Broadcast failed:', e);
            showToast('Erreur réseau - données en file d\'attente', 'warning');
        }
    };

    // --- GESTION PHOTO ---
    const handleTakePhoto = async (useEditing: boolean = false) => {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
            showToast("Permission caméra refusée", "error");
            return;
        }

        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: useEditing, // Recadrage optionnel
            aspect: [4, 3],
            quality: 1,
            base64: false,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            processAndSetImage(result.assets[0].uri);
        }
    };

    const promptCameraMode = () => {
        Alert.alert(
            "Mode Photo",
            "Voulez-vous recadrer la photo ?",
            [
                { text: "Non (Rapide)", onPress: () => handleTakePhoto(false) },
                { text: "Oui (Recadrer)", onPress: () => handleTakePhoto(true) },
                { text: "Annuler", style: "cancel" }
            ],
            { cancelable: true }
        );
    };

    const handlePickImage = async () => {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            showToast("Permission galerie refusée", "error");
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 1,
            base64: false,
        });

        if (!result.canceled && result.assets && result.assets.length > 0) {
            processAndSetImage(result.assets[0].uri);
        }
    };

    const processAndSetImage = async (uri: string) => {
        try {
            // Compression améliorée (0.65) et définition supérieure (1024px)
            const manipResult = await ImageManipulator.manipulateAsync(
                uri,
                [{ resize: { width: 1024 } }],
                { compress: 0.65, format: ImageManipulator.SaveFormat.JPEG, base64: false }
            );
            setTempImage(manipResult.uri);
        } catch (error) {
            console.error("Erreur compression image", error);
            showToast("Erreur traitement image", "error");
        }
    };

    useEffect(() => {
        // SECURE BOOT: Ne rien faire tant que le stockage n'est pas déverrouillé
        if (!isStoreReady) return;

        let mounted = true;
        const initApp = async () => {
            try {
                const s = await configService.init();
                if (mounted) {
                    setSettings(s);
                    // CORRECTION: Récupération persistante du Trigramme
                    const savedTrigram = mmkvStorage.getString(CONFIG.TRIGRAM_STORAGE_KEY) || await AsyncStorage.getItem(CONFIG.TRIGRAM_STORAGE_KEY);
                    const finalUsername = savedTrigram || s.username;

                    if (finalUsername) {
                        setUser(prev => ({ ...prev, callsign: finalUsername, paxColor: s.userArrowColor }));
                        setLoginInput(finalUsername);
                    } else {
                        setUser(prev => ({ ...prev, paxColor: s.userArrowColor }));
                    }
                    setQuickMessagesList(s.quickMessages || DEFAULT_SETTINGS.quickMessages);
                    if (s.customMapUrl) setMapMode('custom');
                }
            } catch (e) { console.log("Config Error:", e); }

            try {
                const permResult = await permissionService.requestAllPermissions();
                if (!permResult.location) setGpsStatus('ERROR');
                await Camera.requestCameraPermissionsAsync();
            } catch (e) { console.log("Perm Error:", e); }

            try {
                const level = await Battery.getBatteryLevelAsync();
                if (mounted && level) setUser(u => ({ ...u, bat: Math.round(level * 100) }));
            } catch (e) { }

            // --- INITIALISATION ID PERSISTANT ---
            // On initialise la connectivité dès le chargement pour récupérer l'ID unique stocké
            // Le service s'occupera d'écraser 'loading...' avec le vrai ID
            try {
                await connectivityService.init(
                    { ...user, id: 'loading...', role: OperatorRole.OPR },
                    OperatorRole.OPR
                );
            } catch (e) { console.log("Init Connectivity Error:", e); }

            if (mounted) {
                setIsAppReady(true);
                setTimeout(() => SplashScreen.hideAsync().catch(() => { }), 500);
            }
        };
        initApp();

        const battSub = Battery.addBatteryLevelListener(({ batteryLevel }) => {
            const newLevel = Math.round(batteryLevel * 100);
            if (Math.abs(newLevel - userRef.current.bat) > 2 || newLevel < 20) {
                setUser(u => ({ ...u, bat: newLevel }));
                connectivityService.updateUser({ bat: newLevel });
            }
        });

        const appStateSub = AppState.addEventListener('change', async nextAppState => {
            if (nextAppState === 'active') {
                connectivityService.handleAppStateChange('active');
                await Notifications.dismissAllNotificationsAsync();
            } else if (nextAppState === 'background') {
                connectivityService.handleAppStateChange('background');
            }
        });



        const locSub = locationService.subscribe((loc) => {
            setGpsStatus('OK');

            // FUSION SENSORS: Managed by LocationService now (See services/locationService.ts)
            // Logic moved to service for background persistence

            setUser(prev => ({ ...prev, lat: loc.latitude, lng: loc.longitude, head: loc.heading || prev.head }));

            // Network Throttling Logic (Moved from Mag Listener)
            const newHead = loc.heading || userRef.current.head;

            // Send update if:
            // 1. Heading changed significantly (> 5 deg)
            // 2. OR Distance changed significantly (> 2m - implicit in GPS update rate)
            // 3. Prevent flood

            const headDiff = Math.abs(newHead - lastSentHead.current);
            // Handling 359->1 transition logic (simplified)
            const circularDiff = Math.min(headDiff, 360 - headDiff); // 359 and 1 -> diff 2

            if (circularDiff > 3 || (loc.speed && loc.speed > 0.5)) {
                lastSentHead.current = newHead;
                connectivityService.updateUserPosition(loc.latitude, loc.longitude, newHead);
            }

            // HEARTBEAT PULSE: Drive connection logic via robust Location service
            connectivityService.pulse();
        });

        return () => {
            mounted = false; locSub(); battSub.remove(); appStateSub.remove();
            locationService.stopTracking();
            // magSubscription remove handled in LocationService now
        };
    }, [isStoreReady]);

    useEffect(() => {
        // MISSION CRITICAL: Capteurs actifs tant qu'on est connecté à une session
        // On ne s'arrête PAS quand la vue change ou que l'app est en arrière-plan
        const isConnectedToSession = !!hostId;

        if (isConnectedToSession) {
            // Configuration GPS avec service au premier plan pour transmission continue
            locationService.updateOptions({
                timeInterval: settings.gpsUpdateInterval,
                foregroundService: {
                    notificationTitle: "PRAXIS",
                    notificationBody: "🛰️ Suivi GPS en arrière plan",
                    notificationColor: "#000000"
                }
            });
            // NEW: Pass orientation for Magnetometer correction (Landscape/Portrait)
            locationService.setOrientation(isLandscape);

            locationService.startTracking();

            locationService.startTracking();

            // NOTE: No need to subscribe here again. The main subscription (line 321)
            // handles data processing, throttling, and connectivity updates.
            // This effect only manages the generic lifecycle (start/stop/options).

            return () => {
                // Nothing to unsubscribe locally, startTracking/stopTracking handles the service state
            };
        } else {
            // Pas de session active - arrêt des capteurs pour économiser la batterie
            locationService.stopTracking();
        }

        return () => {
            // Cleanup uniquement si on quitte vraiment la session
            // Handled mostly by unmount or explicit logout
        };
    }, [hostId, settings.gpsUpdateInterval]); // Removed isLandscape to avoid restart

    // Dedicated effect for Orientation updates (Lightweight)
    useEffect(() => {
        locationService.setOrientation(isLandscape);
    }, [isLandscape]);

    // Initialize ID immediately
    useEffect(() => {
        const storedId = mmkvStorage.getString(CONFIG.SESSION_STORAGE_KEY);
        if (storedId) {
            setUser(prev => ({ ...prev, id: storedId }));
        }
    }, []);



    const handleProtocolData = (data: any, fromId: string) => {
        const senderName = peersRef.current[fromId]?.callsign || fromId.substring(0, 4);

        if (data.type === 'HELLO' && user.role === OperatorRole.HOST) {
            connectivityService.sendTo(fromId, { type: 'SYNC_PINGS', pings: pingsRef.current });
            connectivityService.sendTo(fromId, { type: 'SYNC_LOGS', logs: logsRef.current });
        }

        if (data.type === 'PING') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setPings((prev: PingData[]) => {
                // Deduplication: Si le ping existe déjà, on ne l'ajoute pas
                if (prev.some((p: PingData) => p.id === data.ping.id)) return prev;
                return [...prev, data.ping];
            });
            const isHostile = data.ping.type === 'HOSTILE';

            if (isHostile) {
                const gpsCoords = `${data.ping.lat.toFixed(5)}, ${data.ping.lng.toFixed(5)}`;
                triggerTacticalNotification(
                    `ALERTE PING HOSTILE - ${data.ping.sender}`,
                    `Position: ${gpsCoords} | ${data.ping.msg}`
                );
                showToast(`ENNEMI: ${data.ping.msg} (${gpsCoords})`, 'error');
            } else {
                showToast(`${senderName}: ${data.ping.msg}`, 'info');
                triggerTacticalNotification(`${senderName} - Info`, `${data.ping.msg}`);
            }

            // Gestion Image Architecture
            if (data.ping.hasImage && data.ping.imageId) {
                imageService.exists(data.ping.imageId).then(exists => {
                    if (exists) {
                        // On l'a déjà, on met à jour le lien
                        setPings(prev => prev.map(p => p.id === data.ping.id ? { ...p, imageUri: imageService.getImageUri(data.ping.imageId!) } : p));
                    } else {
                        // On ne l'a pas, on demande (si connecté à celui qui l'a envoyé ou à l'hôte)
                        // On demande à l'expéditeur (fromId)
                        connectivityService.requestImage(data.ping.imageId!, [fromId]);
                    }
                });
            }
        }
        else if (data.type === 'LOG_UPDATE' && Array.isArray(data.logs)) {
            const oldLogs = logsRef.current;
            const newLogs = data.logs;

            if (newLogs.length > oldLogs.length) {
                const latestLog = newLogs[newLogs.length - 1];
                if (latestLog.pax === 'HOSTILE') {
                    const logBody = `${latestLog.lieu || 'Non spécifié'} - ${latestLog.action} / ${latestLog.remarques || 'RAS'}`;
                    triggerTacticalNotification(`MAIN COURANTE - HOSTILE`, logBody);
                }
            }
            setLogs(newLogs);
        }

        else if ((data.type === 'UPDATE_USER' || data.type === 'UPDATE') && data.user) {
            const u = data.user as UserData;
            const prevStatus = peersRef.current[u.id]?.status;
            const prevMsg = peersRef.current[u.id]?.lastMsg;

            setPeers(prev => ({
                ...prev,
                [u.id]: { ...(prev[u.id] || {}), ...u }
            }));

            if (u.status === 'CONTACT' && prevStatus !== 'CONTACT') {
                const coordStr = u.lat && u.lng ? `(${u.lat.toFixed(5)}, ${u.lng.toFixed(5)})` : '';
                showToast(`${u.callsign} : CONTACT ! ${coordStr}`, 'error');
                triggerTacticalNotification(`${u.callsign} - CONTACT`, `Pos: ${u.lat?.toFixed(5) || '?'}, ${u.lng?.toFixed(5) || '?'}`);
            }

            if (u.status !== OperatorStatus.CLEAR && u.status !== OperatorStatus.PROGRESSION) {
                if (u.status === OperatorStatus.BUSY && prevStatus !== OperatorStatus.BUSY) {
                    showToast(`${u.callsign} : OCCUPÉ`, 'warning');
                }
            }

            if (u.lastMsg && u.lastMsg !== prevMsg) {
                if (u.lastMsg !== 'RAS / Effacer' && u.lastMsg !== '') {
                    showToast(`${u.callsign}: ${u.lastMsg}`, 'info');
                    triggerTacticalNotification(`${u.callsign} - Message`, u.lastMsg);
                }
            }
        }
        else if (data.type === 'SYNC_PINGS') setPings(data.pings);
        else if (data.type === 'SYNC_LOGS') setLogs(data.logs);
        else if (data.type === 'PING_MOVE') {
            setPings(prev => prev.map(p => p.id === data.id ? {
                ...p,
                lat: data.lat,
                lng: data.lng,
                // Update image info if provided (integrity check)
                hasImage: data.hasImage !== undefined ? data.hasImage : p.hasImage,
                imageId: data.imageId !== undefined ? data.imageId : p.imageId
            } : p));
        }
        else if (data.type === 'PING_DELETE') setPings(prev => prev.filter(p => p.id !== data.id));
        else if (data.type === 'PING_UPDATE') {
            setPings(prev => prev.map(p => p.id === data.id ? {
                ...p,
                msg: data.msg,
                details: data.details,
                // Fix: Ensure image data is updated
                hasImage: data.hasImage,
                imageId: data.imageId,
                image: null // Legacy clear
            } : p));

            // If update has new image we don't have, request it
            if (data.hasImage && data.imageId) {
                imageService.exists(data.imageId).then(exists => {
                    if (!exists) connectivityService.requestImage(data.imageId, [fromId]);
                });
            }
        }
    };



    // --- EFFECT: Connectivity Events ---
    useEffect(() => {
        const unsubscribe = connectivityService.subscribe((event) => {
            switch (event.type) {
                case 'PEER_OPEN':
                    showToast(`ID Terminal: ${event.id}`, "success");
                    break;
                case 'PEERS_UPDATED':
                    setPeers(event.peers);
                    break;
                case 'HOST_CONNECTED':
                    showToast(`Connecté à la session ${event.hostId}`, "success");
                    setHostId(event.hostId);
                    // Do NOT clear pings here, we will receive sync shortly
                    // setPings([]); 
                    break;
                case 'TOAST':
                    showToast(event.msg, event.level as any);
                    break;
                case 'DATA_RECEIVED':
                    handleProtocolData(event.data, event.from);
                    break;
                case 'DISCONNECTED':
                    if (event.reason === 'KICKED') {
                        Alert.alert("Déconnecté", "Vous avez été exclu de la session.");
                        handleLogout();
                        setView('login');
                    } else if (event.reason === 'NO_HOST') {
                        showToast("Hôte déconnecté", "error");
                    }
                    setHostId('');
                    break;
                case 'RECONNECTING':
                    showToast(`Tentative de reconnexion (${event.attempt})...`, "warning");
                    break;
                case 'NEW_HOST_PROMOTED':
                    if (event.hostId === user.id) {
                        setUser(prev => ({ ...prev, role: OperatorRole.HOST }));
                        Alert.alert("Promotion Hôte", "L'hôte précédent a quitté. Vous êtes maintenant l'hôte de la session.");
                    }
                    setHostId(event.hostId);
                    break;
                case 'SESSION_CLOSED':
                    Alert.alert("Session Terminée", "La session a été fermée car aucun hôte n'est disponible.");
                    handleLogout();
                    setView('menu');
                    break;
                case 'JOIN_REQUEST':
                    // Host side: A banned user wants to join
                    Alert.alert(
                        "Demande de Connexion",
                        `L'utilisateur banni ${event.callsign} (${event.peerId}) souhaite rejoindre la session.`,
                        [
                            { text: "Refuser", onPress: () => connectivityService.denyJoin(event.peerId), style: 'destructive' },
                            { text: "Accepter (Débannir)", onPress: () => connectivityService.approveJoin(event.peerId) }
                        ],
                        { cancelable: false }
                    );
                    break;
                case 'IMAGE_READY':
                    // Image received - Update the ping that was waiting for this image
                    console.log('[App] Image Ready event received:', event.imageId);
                    setPings((prev: PingData[]) => prev.map((p: PingData) => {
                        if (p.imageId === event.imageId) {
                            return { ...p, imageUri: event.uri };
                        }
                        return p;
                    }));
                    break;
                // NEW SYNC HANDLERS
                case 'PING_SYNC_REQUESTED':
                    // Host: Send current pings to client
                    console.log(`[App] Sending Pings Sync to ${event.from} (${pingsRef.current.length} pings)`);
                    connectivityService.sendTo(event.from, { type: 'SYNC_PINGS', pings: pingsRef.current });
                    break;
                case 'PING_SYNC_RECEIVED':
                    // Client: Receive pings from Host
                    console.log(`[App] Received Pings Sync: ${event.pings.length} pings`);
                    setPings(event.pings);
                    break;
            }
        });

        return () => {
            unsubscribe();
        };
    }, [user.id]);

    const finishLogout = useCallback(() => {
        connectivityService.cleanup();
        locationService.stopTracking();
        locationService.stopTracking();
        // magSubscription handled in service
        setPeers({}); setPings([]); setLogs([]); setHostId(''); setView('login');
        // On garde l'ID persistant même après logout, on ne reset que le statut
        setUser(prev => ({ ...prev, role: OperatorRole.OPR, status: OperatorStatus.CLEAR }));
    }, []);

    const joinSession = async (id?: string) => {
        const finalId = id || hostInput.toUpperCase();
        if (!finalId) return;

        const role = OperatorRole.OPR;
        const now = Date.now();
        setUser(prev => ({ ...prev, role: role, paxColor: settings.userArrowColor, joinedAt: now }));

        try {
            // L'init ici sert à nettoyer les listeners précédents et se connecter à l'hôte
            // L'ID persistant est conservé car géré par ConnectivityService
            await connectivityService.init({ ...user, role, paxColor: settings.userArrowColor, joinedAt: now }, role, finalId);
            setHostId(finalId);
            setView('map');
            setLastOpsView('map');
        } catch (error) {
            console.error("Erreur connexion:", error);
            showToast("Erreur de connexion", "error");
        }
    };

    const createSession = async () => {
        const role = OperatorRole.HOST;
        const now = Date.now();
        setUser(prev => ({ ...prev, role: role, paxColor: settings.userArrowColor, joinedAt: now }));
        try {
            // L'init ici configure le rôle Hôte
            await connectivityService.init({ ...user, role, paxColor: settings.userArrowColor, joinedAt: now }, role);

            // FIX: Force hostId update immediately because if peer is reused, PEER_OPEN event won't fire again
            if (user.id && user.id !== 'loading...') {
                setHostId(user.id);
            }

            setView('map');
            setLastOpsView('map');
        } catch (error) {
            showToast("Erreur création session", "error");
        }
    };

    const handleLogout = async () => {
        safeBroadcast({ type: 'CLIENT_LEAVING', id: user.id });
        setTimeout(finishLogout, 500);
    };

    const handleOperatorActionNavigate = (targetId: string) => {
        setNavTargetId(targetId);
        setNavMode('pedestrian');
        setView('map');
        setLastOpsView('map');
        showToast("Ralliement activé");
        connectivityService.sendTo(targetId, { type: 'RALLY_REQ', sender: user.callsign });
    };

    const handleOperatorActionKick = (targetId: string, banType: 'temp' | 'perm') => {
        if (banType === 'perm') {
            connectivityService.banUser(targetId);
            showToast("Utilisateur banni définitivement", "info");
        } else {
            connectivityService.kickUser(targetId);
            showToast("Utilisateur exclu", "info");
        }
        const newPeers = { ...peers }; delete newPeers[targetId]; setPeers(newPeers);
        setSelectedOperatorId(null);
    };

    const handleSendQuickMessage = (msg: string) => {
        // Mise à jour locale + réseau
        setUser(prev => ({ ...prev, lastMsg: msg }));
        connectivityService.updateUser({ lastMsg: msg });
        setShowQuickMsgModal(false);
        setFreeMsgInput('');
        showToast("Message transmis");
    };

    const submitPing = async () => {
        if (!tempPingLoc) return;

        let finalImageUri = null;
        let imageId = null;

        if (tempImage) {
            try {
                const saved = await imageService.saveImage(tempImage);
                finalImageUri = saved.uri;
                imageId = saved.id;
            } catch (e) {
                console.error("Error saving image:", e);
                showToast("Erreur sauvegarde image", "error");
            }
        }

        const newPing: PingData = {
            id: Math.random().toString(36).substr(2, 9),
            lat: tempPingLoc.lat,
            lng: tempPingLoc.lng,
            msg: pingMsgInput || (currentPingType === 'HOSTILE' ? 'ENNEMI' : currentPingType === 'FRIEND' ? 'AMI' : 'OBS'),
            type: currentPingType,
            sender: user.callsign,
            timestamp: Date.now(),
            details: currentPingType === 'HOSTILE' ? hostileDetails : undefined,
            hasImage: !!imageId,
            imageId: imageId || undefined,
            imageUri: finalImageUri || undefined,
            image: null // LEGACY: No more base64
        };


        setPings(prev => [...prev, newPing]);

        // Close modal immediately to prevent duplicates
        setShowPingForm(false);
        setTempPingLoc(null);
        setIsPingMode(false);
        setTempImage(null);

        // Envoyer le ping SANS l'URI locale (inutile pour les autres)
        const pingToSend = { ...newPing, imageUri: undefined };
        await safeBroadcast({ type: 'PING', ping: pingToSend }, currentPingType === 'HOSTILE');

        // NEW: Proactively push image to Host (if we are not Host) to ensure availability for others
        if (imageId && user.role !== OperatorRole.HOST && hostId) {
            console.log("[App] Pushing new image to Host:", imageId);
            connectivityService.sendImage(hostId, imageId);
        }
    };

    const handlePingMove = (updatedPing: PingData) => {
        console.log('[App] handlePingMove:', updatedPing.id, updatedPing.lat, updatedPing.lng);
        setPings(prev => prev.map(p => p.id === updatedPing.id ? updatedPing : p));
        // Transmit associated info (image) to ensure consistency even on move
        safeBroadcast({
            type: 'PING_MOVE',
            id: updatedPing.id,
            lat: updatedPing.lat,
            lng: updatedPing.lng,
            hasImage: updatedPing.hasImage,
            imageId: updatedPing.imageId
        });
    };

    const savePingEdit = async () => {
        if (!editingPing) return;

        let updatedPing = { ...editingPing, msg: pingMsgInput, details: editingPing.type === 'HOSTILE' ? hostileDetails : undefined, timestamp: Date.now() };

        // Si nouvelle image
        if (tempImage) {
            try {
                const saved = await imageService.saveImage(tempImage);
                updatedPing.hasImage = true;
                updatedPing.imageId = saved.id;
                updatedPing.imageUri = saved.uri;
                updatedPing.image = null; // Clear legacy
            } catch (e) {
                console.error("Error saving image edit:", e);
            }
        } else if (tempImage === null && editingPing.imageUri) {
            // If expressly cleared? (UI doesn't support clearing yet, so assume null means 'no change' if we don't have a specific 'clear' flag)
            // But here tempImage is populated with existing image on edit open?
            // Actually `tempImage` state is used for the PREVIEW in the modal.
            // When edit opens, `tempImage` should be set to current image.
            // Check `setEditingPing` usage?
            // Not shown in visible lines, but assuming standard flow.
            // If logic is "image changed", we save.
            // For now, only save if tempImage is NEW (which we can't easily distinguish from existing unless we compare).
            // However, `tempImage` is string.
            // Let's assume if it starts with 'file:', it is existing. If it is new from picker, it is different?
            // Picker returns 'file:...'.
            // Simple logic:: Re-save is harmless (overwrites or new ID).
            // Better: Check if `tempImage` != `editingPing.imageUri`.
        }

        // Simplification for now: If tempImage is set, we use it as the source of truth.
        // NOTE: In submitPing/processAndSetImage, tempImage is SET.
        // We need to know if `tempImage` was changed.

        // Actually, if I change `savePingEdit` to Async, the UI might need to show loading?
        // It's fast enough.

        setPings(prev => prev.map(p => p.id === editingPing.id ? updatedPing : p));

        // Broadcast update
        const updatePayload = {
            type: 'PING_UPDATE',
            id: editingPing.id,
            msg: pingMsgInput,
            details: updatedPing.details,
            hasImage: updatedPing.hasImage,
            imageId: updatedPing.imageId
            // No imageUri
        };

        safeBroadcast(updatePayload);

        // NEW: Proactively push image to Host (if we are not Host) to ensure availability for others
        // Only if we actually added/changed an image (hasImage is true)
        if (updatedPing.hasImage && updatedPing.imageId && user.role !== OperatorRole.HOST && hostId) {
            // Basic check: did we just add it? (tempImage was present)
            // Even if redundant, sending it ensures Host has it.
            if (tempImage) {
                console.log("[App] Pushing edited image to Host:", updatedPing.imageId);
                connectivityService.sendImage(hostId, updatedPing.imageId);
            }
        }

        setEditingPing(null);
        setTempImage(null);
    };

    const deletePing = () => {
        if (!editingPing) return;
        setPings(prev => prev.filter(p => p.id !== editingPing.id));
        safeBroadcast({ type: 'PING_DELETE', id: editingPing.id });
        setEditingPing(null);
        setTempImage(null);
    };

    const handleAddLog = (entry: LogEntry) => {
        setLogs(prev => {
            const newLogs = [...prev, entry];
            safeBroadcast({ type: 'LOG_UPDATE', logs: newLogs });
            return newLogs;
        });
    };
    const handleUpdateLog = (updatedEntry: LogEntry) => {
        setLogs(prev => {
            const newLogs = prev.map(l => l.id === updatedEntry.id ? updatedEntry : l);
            safeBroadcast({ type: 'LOG_UPDATE', logs: newLogs });
            return newLogs;
        });
    };
    const handleDeleteLog = (id: string) => {
        setLogs(prev => {
            const newLogs = prev.filter(l => l.id !== id);
            safeBroadcast({ type: 'LOG_UPDATE', logs: newLogs });
            return newLogs;
        });
    };

    // Correction fonctionnelle : Eviter les scans multiples
    const handleScannerBarCodeScanned = ({ data }: any) => {
        if (scanned) return;
        setScanned(true);
        setShowScanner(false);
        setHostInput(data);
        setTimeout(() => {
            joinSession(data);
            setScanned(false);
        }, 500);
    };

    const requestCamera = async () => {
        const { status } = await Camera.requestCameraPermissionsAsync();
        return status === 'granted';
    };

    const copyToClipboard = async () => {
        await Clipboard.setStringAsync(hostId || user.id || ''); showToast("ID Copié", "success");
    };

    const handleBackPress = () => {
        if (view === 'settings') { setView(lastView); return; }
        if (view === 'ops' || view === 'map') {
            Alert.alert("Déconnexion", "Quitter la session ?", [{ text: "Annuler", style: "cancel" }, { text: "Confirmer", style: "destructive", onPress: handleLogout }]);
        } else { setView('login'); }
    };

    const isLandscapeMap = isLandscape && view === 'map';

    const getLandscapeStyle = (baseStyle: any = {}) => {
        if (isLandscapeMap) {
            return [baseStyle, { opacity: 0.5 }];
        }
        return baseStyle;
    };

    const getLandscapeProps = () => {
        if (isLandscapeMap) {
            return { activeOpacity: 1 };
        }
        return { activeOpacity: 0.5 };
    };

    useEffect(() => {
        if (navTargetId && peers[navTargetId] && user.lat && peers[navTargetId].lat) {
            const target = peers[navTargetId];
            const R = 6371e3;
            const φ1 = user.lat * Math.PI / 180;
            const φ2 = target.lat * Math.PI / 180;
            const Δφ = (target.lat - user.lat) * Math.PI / 180;
            const Δλ = (target.lng - user.lng) * Math.PI / 180;
            const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distM = R * c;

            if (distM < 10) {
                setNavTargetId(null); showToast("Arrivé à destination", "success"); return;
            }

            const speed = navMode === 'pedestrian' ? 1.4 : 13.8;
            const seconds = distM / speed;
            const min = Math.round(seconds / 60);

            setNavInfo({
                dist: distM > 1000 ? `${(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`,
                time: min > 60 ? `${Math.floor(min / 60)}h ${min % 60}min` : `${min} min`
            });
        } else { setNavInfo(null); }
    }, [navTargetId, user.lat, user.lng, peers, navMode]);

    const renderHeader = () => {
        const headerContainerStyle = isLandscapeMap ? styles.headerContentLandscape : styles.headerContent;

        if (navTargetId && navInfo) {
            return (
                <View style={headerContainerStyle}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <MaterialIcons name="navigation" size={24} color={nightOpsMode ? '#ef4444' : '#06b6d4'} />
                        <View>
                            <Text style={{ color: nightOpsMode ? '#ef4444' : '#06b6d4', fontWeight: 'bold', fontSize: 16 }}>RALLIEMENT</Text>
                            <Text style={{ color: nightOpsMode ? '#ef4444' : 'white', fontSize: 12 }}>{peers[navTargetId]?.callsign} - {navInfo.dist} - {navInfo.time}</Text>
                        </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 15, alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => setNavMode('pedestrian')} {...getLandscapeProps()} style={getLandscapeStyle()}>
                            <MaterialIcons name="directions-walk" size={26} color={navMode === 'pedestrian' ? (nightOpsMode ? '#ef4444' : '#22c55e') : '#52525b'} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setNavMode('vehicle')} {...getLandscapeProps()} style={getLandscapeStyle()}>
                            <MaterialIcons name="directions-car" size={26} color={navMode === 'vehicle' ? (nightOpsMode ? '#ef4444' : '#22c55e') : '#52525b'} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setNavTargetId(null)} style={[getLandscapeStyle(), { padding: 8, marginLeft: 10 }]} {...getLandscapeProps()}>
                            <MaterialIcons name="close" size={28} color={nightOpsMode ? '#ef4444' : 'white'} />
                        </TouchableOpacity>
                    </View>
                </View>
            );
        }
        return (
            <View style={headerContainerStyle}>
                <TouchableOpacity onPress={handleBackPress} {...getLandscapeProps()} style={getLandscapeStyle()}>
                    <MaterialIcons name="arrow-back" size={24} color={nightOpsMode ? "#ef4444" : "white"} />
                </TouchableOpacity>

                <Text style={[styles.headerTitle, nightOpsMode && { color: '#ef4444' }, isLandscapeMap && { opacity: 0.5 }]}>Praxis</Text>

                <View style={{ flexDirection: 'row', gap: 15 }}>
                    <TouchableOpacity onPress={() => setShowLogs(true)} {...getLandscapeProps()} style={getLandscapeStyle()}>
                        <MaterialIcons name="history-edu" size={24} color={nightOpsMode ? "#ef4444" : "white"} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setNightOpsMode(!nightOpsMode)} {...getLandscapeProps()} style={getLandscapeStyle()}>
                        <MaterialIcons name="nightlight-round" size={24} color={nightOpsMode ? "#ef4444" : "white"} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setShowSettings(true)} {...getLandscapeProps()} style={getLandscapeStyle()}>
                        <MaterialIcons name="settings" size={24} color={nightOpsMode ? "#ef4444" : "white"} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => {
                        if (view === 'map') { setView('ops'); setLastOpsView('ops'); }
                        else { setView('map'); setLastOpsView('map'); }
                    }} {...getLandscapeProps()} style={getLandscapeStyle()}>
                        <MaterialIcons name={view === 'map' ? "list" : "map"} size={24} color={nightOpsMode ? "#ef4444" : "white"} />
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    const renderContent = () => {
        if (view === 'oi') {
            return <ComposantOrdreInitial onClose={() => setView('login')} />;
        } else if (view === 'login') {
            return (
                <View style={styles.centerContainer}>
                    <TacticalBackground />
                    <TextInput style={styles.input} placeholder="TRIGRAMME" placeholderTextColor="#52525b" maxLength={6} value={loginInput} onChangeText={setLoginInput} autoCapitalize="characters" />
                    <View style={{ marginTop: 50, width: '100%', alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => {
                            if (loginInput.length < 2) return;
                            try {
                                AsyncStorage.setItem(CONFIG.TRIGRAM_STORAGE_KEY, loginInput.toUpperCase());
                                mmkvStorage.set(CONFIG.TRIGRAM_STORAGE_KEY, loginInput.toUpperCase(), true);
                            } catch (e) { }
                            if (loginInput.toUpperCase() !== settings.username) configService.update({ username: loginInput.toUpperCase() });
                            setUser(prev => ({ ...prev, callsign: loginInput.toUpperCase() }));
                            setView('menu');
                        }}
                            style={[styles.strategicaBtn, { backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center' }]}
                        >
                            <Text style={styles.strategicaBtnText}>Praxis</Text>
                        </TouchableOpacity>
                    </View>
                    <View style={{ marginTop: 20, width: '100%', alignItems: 'center' }}>
                        <TouchableOpacity onPress={() => setView('oi')} style={[styles.strategicaBtn, { alignItems: 'center' }]}>
                            <Text style={styles.strategicaBtnText}>Stratégica</Text>
                        </TouchableOpacity>
                    </View>
                    <UpdateNotifier />
                    <PrivacyConsentModal onConsentGiven={() => { }} />
                </View>
            );
        } else if (view === 'menu') {
            return (
                <SafeAreaView style={styles.safeArea}>
                    <View style={styles.menuContainer}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
                            <Text style={styles.sectionTitle}>Praxis</Text>
                            <TouchableOpacity onPress={() => setShowSettings(true)}><MaterialIcons name="settings" size={24} color="white" /></TouchableOpacity>
                        </View>
                        <View style={{ alignItems: 'center', marginBottom: 20 }}>
                            <Text style={{ color: '#52525b', fontSize: 10 }}>ID TERMINAL</Text>
                            <Text style={{ color: '#3b82f6', fontSize: 16, fontWeight: 'bold' }}>{user.id}</Text>
                        </View>
                        {hostId ? (
                            <>
                                <TouchableOpacity onPress={() => setView(lastOpsView)} style={[styles.menuCard, { borderColor: '#22c55e' }]}>
                                    <MaterialIcons name="map" size={40} color="#22c55e" />
                                    <View style={{ marginLeft: 20 }}><Text style={styles.menuCardTitle}>RETOURNER SESSION</Text><Text style={styles.menuCardSubtitle}>{hostId}</Text></View>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => Alert.alert("Déconnexion", "Quitter ?", [{ text: "Non" }, { text: "Oui", onPress: handleLogout }])} style={[styles.menuCard, { borderColor: '#ef4444', marginTop: 20 }]}>
                                    <MaterialIcons name="logout" size={40} color="#ef4444" />
                                    <View style={{ marginLeft: 20 }}><Text style={[styles.menuCardTitle, { color: '#ef4444' }]}>QUITTER</Text></View>
                                </TouchableOpacity>
                            </>
                        ) : (
                            <>
                                <TouchableOpacity onPress={createSession} style={styles.menuCard}>
                                    <MaterialIcons name="add-location-alt" size={40} color="#3b82f6" />
                                    <View style={{ marginLeft: 20 }}><Text style={styles.menuCardTitle}>CRÉER SESSION</Text><Text style={styles.menuCardSubtitle}>Hôte</Text></View>
                                </TouchableOpacity>
                                <View style={styles.divider} />
                                <TextInput style={styles.inputBox} placeholder="ID GROUPE..." placeholderTextColor="#52525b" value={hostInput} onChangeText={setHostInput} autoCapitalize="characters" />
                                <TouchableOpacity onPress={() => joinSession()} style={styles.joinBtn}><Text style={styles.joinBtnText}>REJOINDRE</Text></TouchableOpacity>
                                <TouchableOpacity onPress={() => { requestCamera().then(() => setShowScanner(true)); }} style={[styles.joinBtn, { marginTop: 10, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#333' }]}>
                                    <Text style={{ color: '#71717a' }}>SCANNER QR CODE</Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </SafeAreaView>
            );
        } else {
            return renderMainContent();
        }
    };

    const renderMainContent = () => {
        const isMapMode = view === 'map';
        const isOpsMode = view === 'ops';

        return (
            <View style={{ flex: 1 }}>
                <View style={isLandscapeMap ? styles.headerLandscape : styles.header}>
                    <SafeAreaView>{renderHeader()}</SafeAreaView>
                </View>

                <View style={{ flex: 1, display: isOpsMode ? 'flex' : 'none' }}>
                    <ScrollView contentContainerStyle={styles.grid}>
                        <OperatorCard user={user} isMe style={{ width: '100%' }} isNightOps={nightOpsMode} />
                        {Object.values(peers).filter(p => p.id !== user.id).map(p => (
                            <TouchableOpacity key={p.id} onLongPress={() => setSelectedOperatorId(p.id)} activeOpacity={0.8} style={{ width: '100%' }}>
                                <OperatorCard user={p} me={user} style={{ width: '100%' }} isNightOps={nightOpsMode} />
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>

                <View style={{ flex: 1, display: isMapMode ? 'flex' : 'none', position: 'relative' }}>
                    <View style={{ flex: 1 }}>
                        <TacticalMap
                            me={user} peers={peers} pings={pings}
                            mapMode={mapMode} customMapUrl={settings.customMapUrl}
                            showTrails={showTrails} showPings={showPings}
                            isHost={user.role === OperatorRole.HOST}
                            userArrowColor={settings.userArrowColor}
                            pingMode={isPingMode} navTargetId={navTargetId}
                            nightOpsMode={nightOpsMode}
                            initialCenter={mapState}
                            isLandscape={isLandscape}
                            maxTrailsPerUser={settings.maxTrailsPerUser}
                            onPing={(loc) => {
                                setTempPingLoc(loc);
                                setShowPingMenu(true);
                                setTempImage(null); // Reset image
                            }}
                            onPingMove={(p) => {
                                handlePingMove(p);
                            }}
                            onPingClick={(id) => {
                                const p = pings.find(ping => ping.id === id);
                                if (!p) return;
                                setEditingPing(p);
                                setPingMsgInput(p.msg);
                                if (p.details) setHostileDetails(p.details);
                                // Force load immediately to avoid useEffect delay
                                const imgToSet = p.imageUri || p.image || null;
                                console.log('[App] Immediate load tempImage:', imgToSet);
                                setTempImage(imgToSet);
                            }}
                            onPingLongPress={(id) => {
                                // Handled by WebView
                            }}
                            onNavStop={() => setNavTargetId(null)}
                            onMapMoveEnd={(center, zoom) => setMapState({ ...center, zoom })}
                            isVisible={isMapMode}
                        />

                        <View style={[styles.mapControls, isLandscapeMap && { top: '50%', right: 16, marginTop: -100 }]}>
                            <TouchableOpacity onPress={() => setMapMode(m => m === 'custom' ? 'dark' : m === 'dark' ? 'light' : m === 'light' ? 'satellite' : m === 'satellite' ? 'hybrid' : settings.customMapUrl ? 'custom' : 'dark')} {...getLandscapeProps()} style={[getLandscapeStyle(styles.mapBtn), nightOpsMode && { borderColor: '#7f1d1d', backgroundColor: '#000' }]}>
                                <MaterialIcons name={mapMode === 'dark' ? 'dark-mode' : mapMode === 'light' ? 'light-mode' : mapMode === 'hybrid' ? 'layers' : mapMode === 'custom' ? 'map' : 'satellite'} size={24} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setShowTrails(!showTrails)} {...getLandscapeProps()} style={[getLandscapeStyle(styles.mapBtn), nightOpsMode && { borderColor: '#7f1d1d', backgroundColor: '#000' }]}>
                                <MaterialIcons name={showTrails ? 'visibility' : 'visibility-off'} size={24} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setShowPings(!showPings)} {...getLandscapeProps()} style={[getLandscapeStyle(styles.mapBtn), nightOpsMode && { borderColor: '#7f1d1d', backgroundColor: '#000' }]}>
                                <MaterialIcons name={showPings ? 'location-on' : 'location-off'} size={24} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setIsPingMode(!isPingMode)} {...getLandscapeProps()} style={[getLandscapeStyle(styles.mapBtn), isPingMode ? { backgroundColor: '#dc2626', borderColor: '#f87171' } : null, nightOpsMode && { borderColor: '#7f1d1d', backgroundColor: isPingMode ? '#7f1d1d' : '#000' }]}>
                                <MaterialIcons name="ads-click" size={24} color={nightOpsMode ? "#ef4444" : "white"} />
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>

                <View style={[isLandscapeMap ? styles.footerLandscape : styles.footer, nightOpsMode && { borderTopColor: '#7f1d1d' }]}>
                    <View style={styles.statusRow}>
                        {[OperatorStatus.PROGRESSION, OperatorStatus.CONTACT, OperatorStatus.CLEAR].map(s => (
                            <TouchableOpacity key={s} onPress={() => {
                                setUser(u => ({ ...u, status: s }));
                                connectivityService.updateUser({ status: s, paxColor: settings.userArrowColor });
                            }} {...getLandscapeProps()} style={[getLandscapeStyle(styles.statusBtn), user.status === s ? { backgroundColor: STATUS_COLORS[s], borderColor: 'white' } : null, nightOpsMode && { borderColor: '#7f1d1d', backgroundColor: user.status === s ? '#7f1d1d' : '#000' }]}>
                                <Text style={[styles.statusBtnText, user.status === s ? { color: 'white' } : null, nightOpsMode && { color: '#ef4444' }]}>{s}</Text>
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity onPress={() => setShowQuickMsgModal(true)} {...getLandscapeProps()} style={[getLandscapeStyle(styles.statusBtn), { borderColor: '#06b6d4' }, nightOpsMode && { borderColor: '#ef4444' }]}>
                            <Text style={[styles.statusBtnText, { color: '#06b6d4' }, nightOpsMode && { color: '#ef4444' }]}>MSG</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setShowQRModal(true)} {...getLandscapeProps()} style={[getLandscapeStyle(styles.statusBtn), { borderColor: '#d4d4d8' }, nightOpsMode && { borderColor: '#ef4444' }]}>
                            <MaterialIcons name="qr-code-2" size={16} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        )
    };

    // 0. SECURE BOOT GATE
    if (!fontsLoaded) return null;

    if (!isStoreReady) {
        return (
            <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
                <StatusBar style="light" backgroundColor="#000" />
                <SecureBootView onUnlock={async (key: string) => {
                    try {
                        mmkvStorage.init(key);
                        await usePraxisStore.persist.rehydrate();
                        setIsStoreReady(true);
                    } catch (e) {
                        Alert.alert("Echec", "Clé incorrecte ou données corrompues.");
                    }
                }} />
            </SafeAreaView>
        );
    }

    if (!isAppReady) {
        return (
            <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#ef4444" />
                <Text style={{ color: '#666', marginTop: 20 }}>Chargement Sécurisé...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <StatusBar style="light" backgroundColor="#050505" />
            {renderContent()}

            <Modal visible={showSettings} animationType="slide" onRequestClose={() => setShowSettings(false)}>
                <SettingsView
                    onClose={() => setShowSettings(false)}
                    onUpdate={s => {
                        setSettings(s);
                        if (s.quickMessages) {
                            setQuickMessagesList(s.quickMessages);
                        }
                        setUser(u => ({ ...u, paxColor: s.userArrowColor }));
                        connectivityService.updateUser({ paxColor: s.userArrowColor });
                        if (s.gpsUpdateInterval !== settings.gpsUpdateInterval) {
                            locationService.updateOptions({ timeInterval: s.gpsUpdateInterval });
                        }
                    }}
                />
            </Modal>

            <OperatorActionModal visible={!!selectedOperatorId} targetOperator={peers[selectedOperatorId || ''] || null} currentUserRole={user.role} onClose={() => setSelectedOperatorId(null)} onKick={handleOperatorActionKick} onNavigate={handleOperatorActionNavigate} />
            <MainCouranteView visible={showLogs} logs={logs} role={user.role} onClose={() => setShowLogs(false)} onAddLog={handleAddLog} onUpdateLog={handleUpdateLog} onDeleteLog={handleDeleteLog} />

            <Modal visible={showQuickMsgModal} animationType="fade" transparent>
                <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
                    <View style={[styles.modalContent, {
                        backgroundColor: nightOpsMode ? '#000' : '#18181b', borderWidth: 1, borderColor: nightOpsMode ? '#7f1d1d' : '#333',
                        width: isLandscape ? '100%' : '90%',
                        height: '80%',
                        maxHeight: isLandscape ? '100%' : '80%',
                        borderRadius: isLandscape ? 0 : 24,
                        justifyContent: 'space-between', paddingBottom: 10
                    }]}>
                        <Text style={[styles.modalTitle, { color: nightOpsMode ? '#ef4444' : '#06b6d4', marginBottom: 5 }]}>MESSAGE RAPIDE</Text>

                        <View style={{ flex: 1, width: '100%', marginBottom: 10 }}>
                            <FlatList
                                data={quickMessagesList}
                                keyExtractor={(item, index) => index.toString()}
                                numColumns={isLandscape ? 2 : 1}
                                renderItem={({ item }) => (
                                    <TouchableOpacity onPress={() => handleSendQuickMessage(item.includes("Effacer") ? "" : item)} style={[styles.quickMsgItem, isLandscape && { flex: 1, margin: 5, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8 }]}>
                                        <Text style={styles.quickMsgText}>{item}</Text>
                                    </TouchableOpacity>
                                )}
                                style={{ width: '100%' }}
                                contentContainerStyle={{ paddingBottom: 20 }}
                            />
                        </View>

                        <View style={{ flexDirection: 'row', marginBottom: 10, width: '100%', paddingHorizontal: 5 }}>
                            <TextInput style={[styles.pingInput, { flex: 1, marginBottom: 0, textAlign: 'left' }, nightOpsMode && { borderColor: '#7f1d1d', color: '#ef4444' }]} placeholder="Message libre..." placeholderTextColor={nightOpsMode ? '#7f1d1d' : '#52525b'} value={freeMsgInput} onChangeText={setFreeMsgInput} />
                            <TouchableOpacity onPress={() => handleSendQuickMessage(freeMsgInput)} style={[styles.iconBtn, { backgroundColor: nightOpsMode ? '#7f1d1d' : '#06b6d4', marginLeft: 10 }]}>
                                <MaterialIcons name="send" size={24} color={nightOpsMode ? 'black' : 'white'} />
                            </TouchableOpacity>
                        </View>

                        <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                            <TouchableOpacity onPress={() => setShowQuickMsgModal(false)} style={[styles.iconBtn, { backgroundColor: nightOpsMode ? '#000' : '#27272a', borderWidth: nightOpsMode ? 1 : 0, borderColor: '#7f1d1d' }]}>
                                <MaterialIcons name="close" size={24} color={nightOpsMode ? '#ef4444' : '#a1a1aa'} />
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal visible={showPingMenu} transparent animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={[styles.pingMenuContainer, nightOpsMode && { backgroundColor: '#000', borderColor: '#7f1d1d' }]}>
                        <Text style={styles.modalTitle}>TYPE DE MARQUEUR</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 15, justifyContent: 'center' }}>
                            <TouchableOpacity onPress={() => { setCurrentPingType('HOSTILE'); setShowPingMenu(false); setPingMsgInput(''); setHostileDetails({ position: tempPingLoc ? `${tempPingLoc.lat.toFixed(5)}, ${tempPingLoc.lng.toFixed(5)}` : '', nature: '', attitude: '', volume: '', armes: '', substances: '' }); setShowPingForm(true); }} style={[styles.pingTypeBtn, { backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444' }]}><MaterialIcons name="warning" size={30} color="#ef4444" /><Text style={{ color: '#ef4444', fontWeight: 'bold', fontSize: 10, marginTop: 5 }}>ADVERSAIRE</Text></TouchableOpacity>
                            <TouchableOpacity onPress={() => { setCurrentPingType('FRIEND'); setShowPingMenu(false); setPingMsgInput(''); setShowPingForm(true); }} style={[styles.pingTypeBtn, { backgroundColor: 'rgba(34, 197, 94, 0.2)', borderColor: '#22c55e' }]}><MaterialIcons name="shield" size={30} color="#22c55e" /><Text style={{ color: '#22c55e', fontWeight: 'bold', fontSize: 10, marginTop: 5 }}>AMI</Text></TouchableOpacity>
                            <TouchableOpacity onPress={() => { setCurrentPingType('INTEL'); setShowPingMenu(false); setPingMsgInput(''); setShowPingForm(true); }} style={[styles.pingTypeBtn, { backgroundColor: 'rgba(234, 179, 8, 0.2)', borderColor: '#eab308' }]}><MaterialIcons name="visibility" size={30} color="#eab308" /><Text style={{ color: '#eab308', fontWeight: 'bold', fontSize: 10, marginTop: 5 }}>RENS</Text></TouchableOpacity>
                        </View>
                        <TouchableOpacity onPress={() => setShowPingMenu(false)} style={[styles.iconBtn, { marginTop: 20, backgroundColor: nightOpsMode ? '#000' : '#27272a', borderWidth: nightOpsMode ? 1 : 0, borderColor: '#7f1d1d' }]}>
                            <MaterialIcons name="close" size={24} color={nightOpsMode ? '#ef4444' : 'white'} />
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* MODALE CRÉATION PING */}
            <Modal visible={showPingForm} transparent animationType="slide">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={[styles.modalContent, isLandscape && styles.modalContentLandscape, { height: '80%' }]}>

                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, {
                                color: currentPingType === 'HOSTILE' ? '#ef4444' : currentPingType === 'FRIEND' ? '#22c55e' : '#eab308',
                                marginBottom: 0
                            }]}>
                                {currentPingType === 'HOSTILE' ? 'ADVERSAIRE' : currentPingType === 'FRIEND' ? 'AMI' : 'INFO'}
                            </Text>
                        </View>

                        <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent} keyboardShouldPersistTaps="handled">
                            <Text style={styles.label}>{currentPingType === 'HOSTILE' ? 'Message Principal' : currentPingType === 'FRIEND' ? 'Ami' : 'Info'}</Text>
                            <TextInput
                                style={styles.pingInput}
                                placeholder={currentPingType === 'HOSTILE' ? "Titre / Information" : currentPingType === 'FRIEND' ? "Détails Ami..." : "Détails Renseignement..."}
                                placeholderTextColor="#52525b"
                                value={pingMsgInput}
                                onChangeText={setPingMsgInput}
                                autoFocus={currentPingType !== 'HOSTILE'}
                            />

                            {/* SECTION PHOTO */}
                            <Text style={styles.label}>Photo (Visible par tous)</Text>
                            <View style={styles.photoContainer}>
                                {tempImage ? (
                                    <View style={{ position: 'relative', width: '100%', height: 150 }}>
                                        <TouchableOpacity onPress={() => setFullScreenImage(tempImage)} style={{ flex: 1 }}>
                                            <Image source={{ uri: tempImage }} style={{ width: '100%', height: '100%', borderRadius: 8 }} resizeMode="cover" />
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={() => setTempImage(null)} style={styles.removePhotoBtn}>
                                            <MaterialIcons name="close" size={20} color="white" />
                                        </TouchableOpacity>
                                    </View>
                                ) : (
                                    <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
                                        <TouchableOpacity onPress={promptCameraMode} style={[styles.addPhotoBtn, { flex: 1 }]}>
                                            <MaterialIcons name="camera-alt" size={30} color="#52525b" />
                                            <Text style={{ color: '#52525b', fontSize: 12 }}>Caméra</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={handlePickImage} style={[styles.addPhotoBtn, { flex: 1 }]}>
                                            <MaterialIcons name="photo-library" size={30} color="#52525b" />
                                            <Text style={{ color: '#52525b', fontSize: 12 }}>Galerie</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </View>

                            {currentPingType === 'HOSTILE' && (
                                <View style={{ width: '100%' }}>
                                    <Text style={[styles.label, { color: '#ef4444', marginTop: 10, marginBottom: 10 }]}>PNAVSA</Text>
                                    <View style={styles.canevaContainer}>
                                        <View style={styles.canevaRow}>
                                            <TextInput style={styles.detailInputHalf} placeholder="Position" placeholderTextColor="#52525b" value={hostileDetails.position} onChangeText={t => setHostileDetails({ ...hostileDetails, position: t })} />
                                            <TextInput style={styles.detailInputHalf} placeholder="Nature" placeholderTextColor="#52525b" value={hostileDetails.nature} onChangeText={t => setHostileDetails({ ...hostileDetails, nature: t })} />
                                        </View>
                                        <View style={styles.canevaRow}>
                                            <TextInput style={styles.detailInputHalf} placeholder="Attitude" placeholderTextColor="#52525b" value={hostileDetails.attitude} onChangeText={t => setHostileDetails({ ...hostileDetails, attitude: t })} />
                                            <TextInput style={styles.detailInputHalf} placeholder="Volume" placeholderTextColor="#52525b" value={hostileDetails.volume} onChangeText={t => setHostileDetails({ ...hostileDetails, volume: t })} />
                                        </View>
                                        <View style={styles.canevaRow}>
                                            <TextInput style={styles.detailInputHalf} placeholder="Armement" placeholderTextColor="#52525b" value={hostileDetails.armes} onChangeText={t => setHostileDetails({ ...hostileDetails, armes: t })} />
                                            <TextInput style={styles.detailInputHalf} placeholder="Substances / Tenue" placeholderTextColor="#52525b" value={hostileDetails.substances} onChangeText={t => setHostileDetails({ ...hostileDetails, substances: t })} />
                                        </View>
                                    </View>
                                </View>
                            )}
                        </ScrollView>

                        <View style={[styles.modalFooter, nightOpsMode && { backgroundColor: '#000', borderTopColor: '#7f1d1d' }]}>
                            <TouchableOpacity onPress={() => setShowPingForm(false)} style={[styles.iconBtn, { backgroundColor: nightOpsMode ? '#000' : '#27272a', borderWidth: nightOpsMode ? 1 : 0, borderColor: '#7f1d1d' }]}>
                                <MaterialIcons name="close" size={28} color={nightOpsMode ? '#ef4444' : 'white'} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={submitPing} style={[styles.iconBtn, { backgroundColor: nightOpsMode ? '#7f1d1d' : '#3b82f6' }]}>
                                <MaterialIcons name="check" size={28} color={nightOpsMode ? 'black' : 'white'} />
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* MODALE ÉDITION PING */}
            <Modal visible={!!editingPing && !showPingForm} transparent animationType="slide">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={[styles.modalContent, isLandscape && styles.modalContentLandscape, { height: '80%' }]}>
                        <View style={styles.modalHeader}>
                            <Text style={[styles.modalTitle, { marginBottom: 5 }]}>MODIFICATION</Text>
                            <Text style={{ color: '#71717a', fontSize: 12 }}>Émis par : <Text style={{ fontWeight: 'bold', color: 'white' }}>{editingPing?.sender}</Text></Text>
                        </View>

                        <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent} keyboardShouldPersistTaps="handled">
                            <Text style={styles.label}>Titre / Message</Text>
                            <TextInput style={styles.pingInput} value={pingMsgInput} onChangeText={setPingMsgInput} />

                            {/* SECTION PHOTO ÉDITION */}
                            <Text style={styles.label}>Photo</Text>
                            <View style={styles.photoContainer}>
                                {tempImage ? (
                                    <View style={{ position: 'relative', width: '100%', height: 150 }}>
                                        <TouchableOpacity onPress={() => setFullScreenImage(tempImage)} style={{ flex: 1 }}>
                                            <Image
                                                source={{ uri: tempImage }}
                                                style={{ width: '100%', height: '100%', borderRadius: 8 }}
                                                resizeMode="cover"
                                                onError={(e) => {
                                                    console.log('[App] Image Load Error:', e.nativeEvent.error);
                                                    Alert.alert("Image Error", "Failed to load image:\n" + e.nativeEvent.error);
                                                }}
                                            />
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={() => setTempImage(null)} style={styles.removePhotoBtn}>
                                            <MaterialIcons name="close" size={20} color="white" />
                                        </TouchableOpacity>
                                    </View>
                                ) : (
                                    <View style={{ flexDirection: 'row', gap: 10, width: '100%' }}>
                                        <TouchableOpacity onPress={promptCameraMode} style={[styles.addPhotoBtn, { flex: 1 }]}>
                                            <MaterialIcons name="camera-alt" size={30} color="#52525b" />
                                            <Text style={{ color: '#52525b', fontSize: 12 }}>Caméra</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity onPress={handlePickImage} style={[styles.addPhotoBtn, { flex: 1 }]}>
                                            <MaterialIcons name="photo-library" size={30} color="#52525b" />
                                            <Text style={{ color: '#52525b', fontSize: 12 }}>Galerie</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </View>

                            {editingPing?.type === 'HOSTILE' && (
                                <View style={{ width: '100%' }}>
                                    <Text style={[styles.label, { color: '#ef4444', marginTop: 10, marginBottom: 10 }]}>Canevas Tactique</Text>
                                    <View style={styles.canevaContainer}>
                                        <View style={styles.canevaRow}>
                                            <TextInput style={styles.detailInputHalf} placeholder="Position" value={hostileDetails.position} onChangeText={t => setHostileDetails({ ...hostileDetails, position: t })} />
                                            <TextInput style={styles.detailInputHalf} placeholder="Nature" value={hostileDetails.nature} onChangeText={t => setHostileDetails({ ...hostileDetails, nature: t })} />
                                        </View>
                                        <View style={styles.canevaRow}>
                                            <TextInput style={styles.detailInputHalf} placeholder="Attitude" value={hostileDetails.attitude} onChangeText={t => setHostileDetails({ ...hostileDetails, attitude: t })} />
                                            <TextInput style={styles.detailInputHalf} placeholder="Volume" value={hostileDetails.volume} onChangeText={t => setHostileDetails({ ...hostileDetails, volume: t })} />
                                        </View>
                                        <View style={styles.canevaRow}>
                                            <TextInput style={styles.detailInputHalf} placeholder="Armement" value={hostileDetails.armes} onChangeText={t => setHostileDetails({ ...hostileDetails, armes: t })} />
                                            <TextInput style={styles.detailInputHalf} placeholder="Substances" value={hostileDetails.substances} onChangeText={t => setHostileDetails({ ...hostileDetails, substances: t })} />
                                        </View>
                                    </View>
                                </View>
                            )}
                        </ScrollView>

                        <View style={[styles.modalFooter, nightOpsMode && { backgroundColor: '#000', borderTopColor: '#7f1d1d' }]}>
                            <TouchableOpacity onPress={deletePing} style={[styles.iconBtn, { backgroundColor: '#ef4444' }]}>
                                <MaterialIcons name="delete" size={28} color="white" />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setEditingPing(null)} style={[styles.iconBtn, { backgroundColor: nightOpsMode ? '#000' : '#52525b', borderWidth: nightOpsMode ? 1 : 0, borderColor: '#7f1d1d' }]}>
                                <MaterialIcons name="close" size={28} color={nightOpsMode ? '#ef4444' : 'white'} />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={savePingEdit} style={[styles.iconBtn, { backgroundColor: nightOpsMode ? '#7f1d1d' : '#22c55e' }]}>
                                <MaterialIcons name="check" size={28} color={nightOpsMode ? 'black' : 'white'} />
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal visible={!!fullScreenImage} transparent={true} animationType="fade" onRequestClose={() => setFullScreenImage(null)}>
                <View style={{ flex: 1, backgroundColor: 'black', justifyContent: 'center', alignItems: 'center' }}>
                    <TouchableOpacity style={{ flex: 1, width: '100%', height: '100%' }} onPress={() => setFullScreenImage(null)} activeOpacity={1}>
                        <Image source={{ uri: fullScreenImage || '' }} style={{ flex: 1, width: '100%', height: '100%' }} resizeMode="contain" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setFullScreenImage(null)} style={[styles.iconBtn, { position: 'absolute', top: 40, right: 20, backgroundColor: 'rgba(0,0,0,0.5)' }]}>
                        <MaterialIcons name="close" size={30} color="white" />
                    </TouchableOpacity>
                </View>
            </Modal>

            <Modal visible={showQRModal} animationType="slide" transparent>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContent, isLandscape && { width: '100%', height: '100%', padding: 20, justifyContent: 'space-between', alignItems: 'center' }]}>
                        <Text style={[styles.modalTitle, isLandscape && { alignSelf: 'flex-start', marginBottom: 10 }]}>MON IDENTITY TAG</Text>

                        <View style={{
                            flexDirection: isLandscape ? 'row' : 'column',
                            alignItems: 'center',
                            justifyContent: isLandscape ? 'space-evenly' : 'center',
                            width: '100%',
                            flex: isLandscape ? 1 : 0,
                            gap: isLandscape ? 0 : 0
                        }}>
                            <View style={{
                                padding: 20,
                                backgroundColor: 'white',
                                borderRadius: 10,
                                marginVertical: 20,
                                marginRight: isLandscape ? 40 : 0
                            }}>
                                <QRCode value={hostId || user.id || 'NO_ID'} size={isLandscape ? 120 : 200} backgroundColor="white" color="black" />
                            </View>

                            <TouchableOpacity onPress={copyToClipboard} style={{
                                flexDirection: 'row', alignItems: 'center', backgroundColor: '#f4f4f5', padding: 10, borderRadius: 8,
                                marginLeft: isLandscape ? 20 : 0
                            }}>
                                <Text style={[styles.qrId, { marginTop: 0, marginRight: 10, color: 'black' }]}>{hostId || user.id}</Text>
                                <MaterialIcons name="content-copy" size={20} color="#3b82f6" />
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity onPress={() => setShowQRModal(false)} style={[styles.iconBtn, { marginTop: isLandscape ? 20 : 20, backgroundColor: '#2563eb' }]}>
                            <MaterialIcons name="close" size={28} color="white" />
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <Modal visible={showScanner} animationType="slide"><View style={{ flex: 1, backgroundColor: 'black' }}><CameraView style={{ flex: 1 }} onBarcodeScanned={handleScannerBarCodeScanned} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} /><View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}><View style={{ width: 250, height: 250, borderWidth: 2, borderColor: '#3b82f6', backgroundColor: 'transparent' }} /><Text style={{ color: 'white', marginTop: 20, backgroundColor: 'rgba(0,0,0,0.5)', padding: 5 }}>Visez le QR Code de l'Hôte</Text></View><TouchableOpacity onPress={() => setShowScanner(false)} style={styles.scannerClose}><MaterialIcons name="close" size={30} color="white" /></TouchableOpacity></View></Modal>

            {activeNotif && <NotificationToast message={activeNotif.msg} type={activeNotif.type} isNightOps={nightOpsMode} onDismiss={() => setActiveNotif(null)} />}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#050505' },
    centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
    input: { width: '100%', borderBottomWidth: 2, borderBottomColor: '#3b82f6', borderWidth: 2, borderColor: '#3b82f6', fontSize: 30, color: 'white', textAlign: 'center', padding: 10, backgroundColor: 'transparent' },
    strategicaBtn: { padding: 10, marginTop: 20, borderWidth: 1, borderColor: '#3b82f6', borderRadius: 8, backgroundColor: 'transparent' },
    strategicaBtnText: { color: 'white', fontSize: 16, fontFamily: 'Saira Stencil One', letterSpacing: 2, textTransform: 'uppercase' },
    safeArea: { flex: 1, backgroundColor: '#050505', paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 },
    menuContainer: { flex: 1, padding: 24 },
    sectionTitle: { color: '#71717a', fontSize: 12, fontWeight: 'bold', letterSpacing: 1, marginBottom: 15 },
    menuCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#18181b', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
    menuCardTitle: { color: 'white', fontSize: 18, fontWeight: 'bold' },
    menuCardSubtitle: { color: '#71717a', fontSize: 12 },
    divider: { height: 1, backgroundColor: '#27272a', marginVertical: 30 },
    inputBox: { backgroundColor: '#18181b', borderRadius: 16, padding: 20, fontSize: 20, color: 'white', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', marginBottom: 15 },
    joinBtn: { backgroundColor: '#27272a', padding: 20, borderRadius: 16, alignItems: 'center' },
    joinBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

    header: { backgroundColor: '#09090b', borderBottomWidth: 1, borderBottomColor: '#27272a', paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0, zIndex: 1000, elevation: 1000 },
    headerContent: { height: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },

    headerLandscape: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'transparent', zIndex: 2000, borderBottomWidth: 0, paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 },
    headerContentLandscape: { height: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },

    headerTitle: { color: 'white', fontWeight: '900', fontSize: 18 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 16, gap: 12 },
    scannerClose: { position: 'absolute', top: 50, right: 20, padding: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },

    mapControls: { position: 'absolute', top: 16, right: 16, gap: 12, zIndex: 2000, elevation: 2000 },
    mapBtn: {
        width: 48, height: 48, borderRadius: 24,
        backgroundColor: 'rgba(24, 24, 27, 0.9)',
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: '#27272a'
    },

    footer: { backgroundColor: '#050505', borderTopWidth: 1, borderTopColor: '#27272a', paddingBottom: 20, zIndex: 2000, elevation: 2000 },

    footerLandscape: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'transparent', zIndex: 2000, paddingBottom: 10, borderTopWidth: 0 },

    statusRow: { flexDirection: 'row', padding: 8, gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
    statusBtn: {
        flexGrow: 1, // Permet de grandir mais pas forcément rétrécir à l'infini
        minWidth: 80, // Force le wrap si l'écran est trop étroit
        paddingHorizontal: 8, paddingVertical: 12,
        borderRadius: 8, backgroundColor: '#18181b',
        borderWidth: 1, borderColor: '#27272a',
        alignItems: 'center', justifyContent: 'center'
    },
    statusBtnText: { color: '#71717a', fontSize: 13, fontWeight: 'bold' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    modalContent: {
        width: '95%',
        backgroundColor: '#18181b',
        borderRadius: 24,
        borderWidth: 1,
        borderColor: '#333',
        height: '80%',
        overflow: 'hidden'
    },
    modalContentLandscape: {
        width: '80%',
        maxHeight: '95%',
        borderRadius: 16
    },
    modalHeader: {
        paddingVertical: 15,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
        backgroundColor: '#27272a',
        alignItems: 'center'
    },
    modalBody: {
        flex: 1,
        width: '100%'
    },
    modalBodyContent: {
        padding: 20,
        paddingBottom: 40
    },
    modalFooter: {
        flexDirection: 'row',
        padding: 15,
        borderTopWidth: 1,
        borderTopColor: '#333',
        backgroundColor: '#18181b',
        gap: 20,
        justifyContent: 'center'
    },

    modalTitle: { fontSize: 18, fontWeight: '900', color: 'white' },
    qrId: { marginTop: 20, fontSize: 10, backgroundColor: '#f4f4f5', padding: 8, borderRadius: 4 },

    pingInput: { width: '100%', backgroundColor: 'black', color: 'white', padding: 16, borderRadius: 12, textAlign: 'center', fontSize: 18, marginBottom: 10, borderWidth: 1, borderColor: '#333', minHeight: 50 },

    iconBtn: { width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center' },

    quickMsgItem: { paddingVertical: 20, paddingHorizontal: 15, width: '100%', alignItems: 'center' },
    quickMsgText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
    pingMenuContainer: { width: '85%', backgroundColor: '#09090b', borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
    pingTypeBtn: { width: 80, height: 80, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },

    label: { color: '#a1a1aa', fontSize: 12, alignSelf: 'flex-start', marginBottom: 5, marginLeft: 5, fontWeight: 'bold' },

    canevaContainer: { width: '100%', gap: 10 },
    canevaRow: { flexDirection: 'row', gap: 10, justifyContent: 'space-between', width: '100%' },
    detailInputHalf: { flex: 1, backgroundColor: '#000', color: 'white', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#333', minHeight: 50, fontSize: 16 },

    nightOpsOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(127, 29, 29, 0.2)', zIndex: 99999, pointerEvents: 'none' },

    photoContainer: { width: '100%', marginVertical: 10, alignItems: 'center', justifyContent: 'center' },
    addPhotoBtn: { height: 100, borderRadius: 12, borderWidth: 2, borderColor: '#333', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)' },
    removePhotoBtn: { position: 'absolute', top: 5, right: 5, backgroundColor: 'rgba(239, 68, 68, 0.8)', borderRadius: 15, width: 30, height: 30, justifyContent: 'center', alignItems: 'center' }
});

export default App;
