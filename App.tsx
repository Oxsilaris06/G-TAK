import './polyfills';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  SafeAreaView, Platform, Modal, StatusBar as RNStatusBar, Alert, ScrollView, ActivityIndicator,
  PermissionsAndroid, Animated, PanResponder, FlatList, KeyboardAvoidingView, AppState
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import QRCode from 'react-native-qrcode-svg';
import { Camera } from 'expo-camera'; 
import { CameraView } from 'expo-camera/next';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Magnetometer } from 'expo-sensors';
import * as SplashScreen from 'expo-splash-screen';

// --- IMPORTS LOCAUX ---
import { UserData, OperatorStatus, OperatorRole, ViewType, PingData, AppSettings, DEFAULT_SETTINGS, PingType, HostileDetails, LogEntry } from './types';
import { CONFIG, STATUS_COLORS } from './constants';
import { configService } from './services/configService';
import { connectivityService, ConnectivityEvent } from './services/connectivityService'; 

import OperatorCard from './components/OperatorCard';
import TacticalMap from './components/TacticalMap';
import SettingsView from './components/SettingsView';
import OperatorActionModal from './components/OperatorActionModal';
import MainCouranteView from './components/MainCouranteView';
import PrivacyConsentModal from './components/PrivacyConsentModal';

// --- CONFIG INITIALE ---
try { SplashScreen.preventAutoHideAsync().catch(() => {}); } catch (e) {}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false, 
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let DEFAULT_MSG_JSON: string[] = [];
try { DEFAULT_MSG_JSON = require('./msg.json'); } catch (e) {}

// --- COMPOSANT NOTIFICATION FLOTTANTE ---
const NavNotification = ({ message, type, isNightOps, onDismiss }: { message: string, type: 'alert' | 'info' | 'success' | 'warning', isNightOps: boolean, onDismiss: () => void }) => {
    const pan = useRef(new Animated.ValueXY()).current;
    const scaleAnim = useRef(new Animated.Value(0.8)).current;
    const opacityAnim = useRef(new Animated.Value(0)).current;
    
    useEffect(() => {
        Animated.parallel([
            Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true }),
            Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true })
        ]).start();

        let pulseAnim: Animated.CompositeAnimation | null = null;
        if (type === 'alert') {
            pulseAnim = Animated.loop(
                Animated.sequence([
                    Animated.timing(scaleAnim, { toValue: 1.05, duration: 300, useNativeDriver: true }),
                    Animated.timing(scaleAnim, { toValue: 1, duration: 300, useNativeDriver: true })
                ])
            );
            pulseAnim.start();
        }

        if (type !== 'alert') {
            const timer = setTimeout(handleDismiss, 4000);
            return () => clearTimeout(timer);
        }
        return () => pulseAnim?.stop();
    }, [type]);

    const handleDismiss = () => {
        Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(onDismiss);
    };

    const panResponder = useRef(PanResponder.create({
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: Animated.event([null, { dx: pan.x }], { useNativeDriver: false }),
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) > 50) {
              Animated.timing(pan, { toValue: { x: gesture.dx > 0 ? 500 : -500, y: 0 }, useNativeDriver: false, duration: 200 }).start(onDismiss);
          } else {
              Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
          }
        }
    })).current;

    const getColors = () => {
        if (isNightOps) return { bg: '#000', border: '#7f1d1d', text: '#ef4444', icon: '#ef4444' };
        switch(type) {
            case 'alert': return { bg: '#450a0a', border: '#ef4444', text: '#fff', icon: '#ef4444' };
            case 'success': return { bg: '#052e16', border: '#22c55e', text: '#fff', icon: '#22c55e' };
            case 'warning': return { bg: '#422006', border: '#eab308', text: '#fff', icon: '#eab308' };
            default: return { bg: '#18181b', border: '#3b82f6', text: '#fff', icon: '#3b82f6' };
        }
    };
    const colors = getColors();

    return (
      <Animated.View 
        style={[styles.navNotif, { transform: [{ translateX: pan.x }, { scale: scaleAnim }], opacity: opacityAnim, backgroundColor: colors.bg, borderColor: colors.border }]} 
        {...panResponder.panHandlers}
      >
          <MaterialIcons name={type === 'alert' ? "warning" : type === 'success' ? "check-circle" : type === 'warning' ? "wifi-off" : "info"} size={28} color={colors.icon} />
          <Text style={[styles.navNotifText, {color: colors.text}]}>{message}</Text>
      </Animated.View>
    );
};

const App: React.FC = () => {
  useKeepAwake();
  
  // --- STATE GESTION ---
  const [isAppReady, setIsAppReady] = useState(false);
  const [activeNotif, setActiveNotif] = useState<{ id: string, msg: string, type: 'alert' | 'info' | 'success' | 'warning' } | null>(null);
  
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [user, setUser] = useState<UserData>({ id: '', callsign: '', role: OperatorRole.OPR, status: OperatorStatus.CLEAR, joinedAt: Date.now(), bat: 100, head: 0, lat: 0, lng: 0, lastMsg: '' });

  // Navigation
  const [view, setView] = useState<ViewType>('login');
  const [lastView, setLastView] = useState<ViewType>('menu'); 
  const [lastOpsView, setLastOpsView] = useState<ViewType>('map');

  // Données Session
  const [peers, setPeers] = useState<Record<string, UserData>>({});
  const [pings, setPings] = useState<PingData[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [hostId, setHostId] = useState<string>('');
  
  // REFS POUR ACCÈS SYNCHRONE (Vital pour éviter les stale closures dans les listeners)
  const pingsRef = useRef(pings);
  const logsRef = useRef(logs);
  const peersRef = useRef(peers);
  const userRef = useRef(user);

  useEffect(() => { pingsRef.current = pings; }, [pings]);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  useEffect(() => { peersRef.current = peers; }, [peers]);
  useEffect(() => { userRef.current = user; }, [user]);

  // UI State & Formulaires
  const [loginInput, setLoginInput] = useState('');
  const [hostInput, setHostInput] = useState('');
  const [mapMode, setMapMode] = useState<'dark' | 'light' | 'satellite'>('satellite');
  const [showTrails, setShowTrails] = useState(true);
  const [showPings, setShowPings] = useState(true);
  const [isPingMode, setIsPingMode] = useState(false);
  const [nightOpsMode, setNightOpsMode] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  
  const [showQRModal, setShowQRModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [showQuickMsgModal, setShowQuickMsgModal] = useState(false);
  const [showPingMenu, setShowPingMenu] = useState(false);
  const [showPingForm, setShowPingForm] = useState(false);
  
  const [freeMsgInput, setFreeMsgInput] = useState(''); 
  const [quickMessagesList, setQuickMessagesList] = useState<string[]>([]);
  const [tempPingLoc, setTempPingLoc] = useState<any>(null);
  const [currentPingType, setCurrentPingType] = useState<PingType>('FRIEND');
  const [pingMsgInput, setPingMsgInput] = useState('');
  const [hostileDetails, setHostileDetails] = useState<HostileDetails>({ position: '', nature: '', attitude: '', volume: '', armes: '', substances: '' });
  
  const [editingPing, setEditingPing] = useState<PingData | null>(null);
  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null);
  const [navTargetId, setNavTargetId] = useState<string | null>(null);
  const [bannedPeers, setBannedPeers] = useState<string[]>([]); // Manquait dans la version précédente

  // System
  const [isServicesReady, setIsServicesReady] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'WAITING' | 'OK' | 'ERROR'>('WAITING');
  const lastLocationRef = useRef<any>(null);
  const lastHeadBroadcast = useRef<number>(0);
  const gpsSubscription = useRef<Location.LocationSubscription | null>(null);
  const appState = useRef(AppState.currentState);
  const lastSysNotifId = useRef<string | null>(null);

  // --- NOTIFICATIONS & TOASTS ---
  const triggerAppNotification = (id: string, msg: string, type: 'alert' | 'info' | 'success' | 'warning') => {
      if (activeNotif && activeNotif.id === id && activeNotif.msg === msg) return;
      setActiveNotif({ id, msg, type });
      if (type === 'alert' || type === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      else if (type === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const sendSystemNotification = async (title: string, body: string) => {
      if (settings.disableBackgroundNotifications) return;
      if (appState.current === 'active') return;
      if (lastSysNotifId.current) await Notifications.dismissNotificationAsync(lastSysNotifId.current);
      const id = await Notifications.scheduleNotificationAsync({ content: { title, body, sound: true }, trigger: null });
      lastSysNotifId.current = id;
  };

  const showToast = (msg: string, type: 'info' | 'error' | 'success' | 'warning' = 'info') => {
      triggerAppNotification('TOAST', msg, type);
  };

  // --- ACTIONS GLOBALES ---
  const copyToClipboard = async () => { 
      await Clipboard.setStringAsync(hostId || user.id || ''); 
      showToast("ID Copié", "success"); 
  };

  const handleBackPress = () => {
      if (view === 'settings') { setView(lastView); return; }
      if (view === 'ops' || view === 'map') {
          Alert.alert("Déconnexion", "Quitter la session ?", [{ text: "Annuler", style: "cancel" }, { text: "Confirmer", style: "destructive", onPress: handleLogout }]);
      } else { setView('login'); }
  };

  // --- INITIALISATION APP ---
  useEffect(() => {
      let mounted = true;
      const subscription = AppState.addEventListener('change', nextAppState => {
          if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
              if (hostId) connectivityService.broadcast({ type: 'UPDATE', user: userRef.current });
          }
          appState.current = nextAppState;
      });

      const initApp = async () => {
          try {
              const s = await configService.init();
              if (mounted) {
                  setSettings(s);
                  if (s.username) { setUser(prev => ({...prev, callsign: s.username})); setLoginInput(s.username); }
                  setQuickMessagesList(s.quickMessages || DEFAULT_SETTINGS.quickMessages);
              }
          } catch(e) {}
          await bootstrapPermissionsAsync();
          if (mounted) { 
              setIsAppReady(true); 
              setTimeout(async () => { await SplashScreen.hideAsync().catch(() => {}); }, 500); 
          }
      };
      initApp();

      const unsubConfig = configService.subscribe((newSettings) => {
          setSettings(newSettings);
          if (newSettings.quickMessages) setQuickMessagesList(newSettings.quickMessages);
          if (newSettings.username && newSettings.username !== userRef.current.callsign) {
              connectivityService.updateUser({ callsign: newSettings.username });
              setUser(prev => ({ ...prev, callsign: newSettings.username }));
          }
          if (gpsSubscription.current) startGpsTracking(newSettings.gpsUpdateInterval);
      });

      const unsubConn = connectivityService.subscribe((event) => {
          handleConnectivityEvent(event);
      });
      
      return () => { mounted = false; unsubConfig(); unsubConn(); subscription.remove(); };
  }, []);

  const bootstrapPermissionsAsync = async () => {
      try {
          if (Platform.OS === 'android') {
             await PermissionsAndroid.requestMultiple([
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
                PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
                PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
             ]).catch(() => {});
          }
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status === 'granted') { await Location.requestBackgroundPermissionsAsync().catch(() => {}); setGpsStatus('OK'); }
          const camStatus = await Camera.getCameraPermissionsAsync();
          setHasCameraPermission(camStatus.status === 'granted');
      } catch (e) {}
  };

  const requestCamera = async () => {
      const res = await Camera.requestCameraPermissionsAsync();
      setHasCameraPermission(res.status === 'granted');
  };

  // --- LOGIQUE RÉSEAU (Event Handler) ---
  const handleConnectivityEvent = (event: ConnectivityEvent) => {
      switch (event.type) {
          case 'PEER_OPEN': 
              setUser(prev => ({ ...prev, id: event.id })); 
              setIsServicesReady(true); 
              break;
          
          case 'PEERS_UPDATED': 
              setPeers(prev => {
                  const newPeers = { ...prev };
                  Object.values(event.peers).forEach(p => {
                      const duplicateId = Object.keys(newPeers).find(k => newPeers[k].callsign === p.callsign && k !== p.id);
                      if (duplicateId) delete newPeers[duplicateId];
                      newPeers[p.id] = p;
                  });
                  const currentIds = Object.keys(event.peers);
                  Object.keys(newPeers).forEach(id => {
                      if (!currentIds.includes(id) && id !== userRef.current.id) delete newPeers[id];
                  });
                  return newPeers;
              });
              break;
          
          case 'HOST_CONNECTED': 
              setHostId(event.hostId); 
              showToast("Connecté au réseau tactique", "success");
              break;
          
          case 'RECONNECTING':
              showToast(`Réseau instable. Tentative ${event.attempt}...`, "warning");
              break;

          case 'TOAST': 
              showToast(event.msg, event.level as any); 
              break;
          
          case 'DATA_RECEIVED': 
              handleProtocolData(event.data, event.from); 
              break;
          
          case 'DISCONNECTED': 
              if (event.reason === 'KICKED') { 
                  Alert.alert("Session Terminée", "Vous avez été exclu de la session."); 
                  finishLogout(); 
              }
              else if (event.reason === 'NO_HOST') { 
                  showToast("Lien Hôte perdu. En attente...", "error"); 
              }
              else if (event.reason === 'NETWORK_ERROR') {
                  showToast("Erreur réseau critique.", "error");
              }
              break;
          
          case 'MIGRATION_START':
              showToast("Hôte perdu. Élection en cours...", "warning");
              break;
              
          case 'NEW_HOST_PROMOTED':
              setHostId(event.hostId);
              if (event.hostId === userRef.current.id) {
                  setUser(prev => ({ ...prev, role: OperatorRole.HOST }));
                  Alert.alert("Promotion", "Vous êtes le nouveau Chef de Session (Hôte).");
              } else {
                  showToast("Nouveau Hôte désigné", "info");
              }
              break;
      }
  };

  const handleProtocolData = (data: any, fromId: string) => {
      if (bannedPeers.includes(fromId)) return;

      // SYNC HOST
      if (data.type === 'FULL' && userRef.current.role === OperatorRole.HOST) {
          connectivityService.sendTo(fromId, { type: 'SYNC_PINGS', pings: pingsRef.current });
          connectivityService.sendTo(fromId, { type: 'SYNC_LOGS', logs: logsRef.current });
      }

      // SYNC DATA
      else if (data.type === 'SYNC_PINGS' && Array.isArray(data.pings)) {
          setPings(data.pings);
      }
      else if (data.type === 'SYNC_LOGS' && Array.isArray(data.logs)) {
          setLogs(data.logs);
      }

      // PINGS & ALERTS
      else if (data.type === 'PING') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setPings(prev => [...prev, data.ping]);
            const p = data.ping;
            const isHostile = p.type === 'HOSTILE';
            triggerAppNotification(p.sender, `${p.type === 'HOSTILE' ? 'CONTACT' : 'INFO'}: ${p.msg}`, isHostile ? 'alert' : 'info');
            sendSystemNotification(isHostile ? "⚠️ CONTACT" : "Info Tactique", `${p.sender}: ${p.msg}`);
      }
      else if (data.type === 'PING_MOVE') {
          setPings(prev => prev.map(p => p.id === data.id ? { ...p, lat: data.lat, lng: data.lng } : p));
      }
      else if (data.type === 'PING_DELETE') {
          setPings(prev => prev.filter(p => p.id !== data.id));
      }
      else if (data.type === 'PING_UPDATE') {
          setPings(prev => prev.map(p => p.id === data.id ? { ...p, msg: data.msg, details: data.details } : p));
      }
      else if (data.type === 'LOG_UPDATE' && Array.isArray(data.logs)) {
          setLogs(data.logs);
          if (showLogs) showToast("Main Courante mise à jour", "info");
      }
      
      // USER UPDATES
      else if ((data.type === 'UPDATE' || data.type === 'UPDATE_USER') && data.user) {
          const u = data.user;
          const currentPeer = peersRef.current[u.id]; 
          if (currentPeer && currentPeer.status !== u.status) {
              if (u.status === OperatorStatus.CONTACT || u.status === OperatorStatus.BUSY) {
                  triggerAppNotification(u.callsign, `STATUT: ${u.status}`, 'alert');
                  sendSystemNotification("Alerte Statut", `${u.callsign} est ${u.status}`);
              }
          }
          if (currentPeer && currentPeer.lastMsg !== u.lastMsg && u.lastMsg) {
              triggerAppNotification(u.callsign, `MSG: ${u.lastMsg}`, 'info');
              sendSystemNotification("Message", `${u.callsign}: ${u.lastMsg}`);
          }
      }
  };

  const startGpsTracking = useCallback(async (interval: number) => {
      if (gpsSubscription.current) gpsSubscription.current.remove();
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { setGpsStatus('ERROR'); return; }
        
        gpsSubscription.current = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High, timeInterval: interval, distanceInterval: 5 }, 
            (loc) => {
                const { latitude, longitude, heading, speed } = loc.coords;
                setGpsStatus('OK');
                setUser(prev => {
                    const gpsHead = (speed && speed > 1 && heading !== null) ? heading : prev.head;
                    if (!lastLocationRef.current || Math.abs(latitude - lastLocationRef.current.lat) > 0.0001 || Math.abs(longitude - lastLocationRef.current.lng) > 0.0001) {
                        connectivityService.updateUserPosition(latitude, longitude, gpsHead);
                        lastLocationRef.current = { lat: latitude, lng: longitude };
                    }
                    return { ...prev, lat: latitude, lng: longitude, head: gpsHead };
                });
            }
        );
      } catch(e) { setGpsStatus('ERROR'); }
  }, []);

  const finishLogout = useCallback(() => {
      connectivityService.cleanup();
      if (gpsSubscription.current) { gpsSubscription.current.remove(); gpsSubscription.current = null; }
      setPeers({}); setPings([]); setLogs([]); setHostId(''); setView('login'); 
      setIsServicesReady(false); setNavTargetId(null);
      setUser(prev => ({...prev, id: '', role: OperatorRole.OPR, status: OperatorStatus.CLEAR, lastMsg: '' }));
  }, []);

  useEffect(() => { 
      Magnetometer.setUpdateInterval(100); 
      const sub = Magnetometer.addListener((data) => { 
          let angle = Math.atan2(data.y, data.x) * (180 / Math.PI) - 90; 
          if (angle < 0) angle += 360; 
          setUser(prev => { 
              if (Math.abs(prev.head - angle) > 2) {
                  const newHead = Math.floor(angle);
                  const now = Date.now();
                  if (now - lastHeadBroadcast.current > (settings.orientationUpdateInterval || 500) && hostId) {
                      connectivityService.broadcast({ type: 'UPDATE_USER', user: { ...prev, head: newHead } });
                      lastHeadBroadcast.current = now;
                  }
                  return { ...prev, head: newHead }; 
              }
              return prev; 
          }); 
      }); 
      return () => sub && sub.remove(); 
  }, [hostId, settings.orientationUpdateInterval]);

  const joinSession = async (id?: string) => {
      const finalId = id || hostInput.toUpperCase();
      if (!finalId) return;
      setHostId(finalId);
      startGpsTracking(settings.gpsUpdateInterval);
      setUser(prev => ({ ...prev, role: OperatorRole.OPR }));
      connectivityService.init({ ...user, role: OperatorRole.OPR }, OperatorRole.OPR, finalId);
      setView('map'); setLastOpsView('map');
  };

  const createSession = async () => {
      startGpsTracking(settings.gpsUpdateInterval);
      setUser(prev => ({ ...prev, role: OperatorRole.HOST }));
      connectivityService.init({ ...user, role: OperatorRole.HOST }, OperatorRole.HOST);
      setView('map'); setLastOpsView('map');
  };

  const handleLogout = () => {
      if (user.role === OperatorRole.HOST) connectivityService.broadcast({ type: 'CLIENT_LEAVING', id: user.id });
      else connectivityService.broadcast({ type: 'CLIENT_LEAVING', id: user.id, callsign: user.callsign });
      finishLogout();
  };

  const handleOperatorActionNavigate = (targetId: string) => { setNavTargetId(targetId); setView('map'); setLastOpsView('map'); showToast("Guidage GPS activé"); };
  const handleOperatorActionKick = (targetId: string, type: 'temp' | 'perm') => {
      connectivityService.kickUser(targetId, type === 'perm');
      const newPeers = { ...peers }; delete newPeers[targetId]; setPeers(newPeers);
      showToast(type === 'perm' ? "Banni définitivement" : "Exclu temporairement");
  };

  const handleSendQuickMessage = (msg: string) => { setUser(prev => ({ ...prev, lastMsg: msg })); connectivityService.updateUser({ lastMsg: msg }); setShowQuickMsgModal(false); setFreeMsgInput(''); showToast(msg ? `Msg: ${msg}` : "Message effacé"); };
  const handleChangeStatus = (s: OperatorStatus) => { setUser(prev => ({ ...prev, status: s })); connectivityService.updateUserStatus(s); if (s === OperatorStatus.CONTACT) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); };
  
  const submitPing = () => {
      if (!tempPingLoc) return;
      const newPing: PingData = {
          id: Math.random().toString(36).substr(2, 9), lat: tempPingLoc.lat, lng: tempPingLoc.lng,
          msg: pingMsgInput || (currentPingType === 'HOSTILE' ? 'ENNEMI' : currentPingType === 'FRIEND' ? 'AMI' : 'OBS'),
          type: currentPingType, sender: user.callsign, timestamp: Date.now(),
          details: currentPingType === 'HOSTILE' ? hostileDetails : undefined
      };
      setPings(prev => [...prev, newPing]);
      connectivityService.broadcast({ type: 'PING', ping: newPing });
      setShowPingForm(false); setTempPingLoc(null); setIsPingMode(false);
  };

  const handlePingMove = (updatedPing: PingData) => {
      setPings(prev => prev.map(p => p.id === updatedPing.id ? updatedPing : p));
      connectivityService.broadcast({ type: 'PING_MOVE', id: updatedPing.id, lat: updatedPing.lat, lng: updatedPing.lng });
  };

  const savePingEdit = () => {
      if (!editingPing) return;
      const updatedPing = { ...editingPing, msg: pingMsgInput, details: editingPing.type === 'HOSTILE' ? hostileDetails : undefined };
      setPings(prev => prev.map(p => p.id === editingPing.id ? updatedPing : p));
      connectivityService.broadcast({ type: 'PING_UPDATE', id: editingPing.id, msg: pingMsgInput, details: updatedPing.details });
      setEditingPing(null);
  };
  const deletePing = () => {
      if (!editingPing) return;
      setPings(prev => prev.filter(p => p.id !== editingPing.id));
      connectivityService.broadcast({ type: 'PING_DELETE', id: editingPing.id });
      setEditingPing(null);
  };

  const handleAddLog = (entry: LogEntry) => {
      setLogs(prev => {
          const newLogs = [...prev, entry];
          connectivityService.broadcast({ type: 'LOG_UPDATE', logs: newLogs });
          return newLogs;
      });
  };
  const handleDeleteLog = (id: string) => {
      setLogs(prev => {
          const newLogs = prev.filter(l => l.id !== id);
          connectivityService.broadcast({ type: 'LOG_UPDATE', logs: newLogs });
          return newLogs;
      });
  };

  const handleScannerBarCodeScanned = ({ data }: any) => {
    setShowScanner(false);
    setHostInput(data);
    setTimeout(() => joinSession(data), 500);
  };

  const renderMainContent = () => (
      <View style={{flex: 1}}>
          <View style={{ flex: 1, display: view === 'ops' ? 'flex' : 'none' }}>
              <SafeAreaView style={styles.header}>
                  <View style={styles.headerContent}>
                      <TouchableOpacity onPress={handleBackPress}><MaterialIcons name="arrow-back" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                      <Text style={[styles.headerTitle, nightOpsMode && {color: '#ef4444'}]}>TacSuite</Text>
                      <View style={{flexDirection: 'row', gap: 15}}>
                          <TouchableOpacity onPress={() => setShowLogs(true)}><MaterialIcons name="history-edu" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                          <TouchableOpacity onPress={() => setNightOpsMode(!nightOpsMode)}><MaterialIcons name="nightlight-round" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                          <TouchableOpacity onPress={() => { setLastView(view); setView('settings'); }}><MaterialIcons name="settings" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                          <TouchableOpacity onPress={() => { setView('map'); setLastOpsView('map'); }}><MaterialIcons name="map" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                      </View>
                  </View>
              </SafeAreaView>
              <ScrollView contentContainerStyle={styles.grid}>
                  <OperatorCard user={user} isMe style={{ width: '100%' }} isNightOps={nightOpsMode} />
                  {Object.values(peers).filter(p => p.id !== user.id).map(p => (
                      <TouchableOpacity key={p.id} onLongPress={() => setSelectedOperatorId(p.id)} activeOpacity={0.8} style={{ width: '100%' }}>
                          <OperatorCard user={p} me={user} style={{ width: '100%' }} isNightOps={nightOpsMode} />
                      </TouchableOpacity>
                  ))}
              </ScrollView>
          </View>

          <View style={{ flex: 1, display: view === 'map' ? 'flex' : 'none' }}>
              <SafeAreaView style={styles.header}>
                  <View style={styles.headerContent}>
                      <TouchableOpacity onPress={handleBackPress}><MaterialIcons name="arrow-back" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                      <Text style={[styles.headerTitle, nightOpsMode && {color: '#ef4444'}]}>TacSuite</Text>
                      <View style={{flexDirection: 'row', gap: 15}}>
                          <TouchableOpacity onPress={() => setShowLogs(true)}><MaterialIcons name="history-edu" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                          <TouchableOpacity onPress={() => setNightOpsMode(!nightOpsMode)}><MaterialIcons name="nightlight-round" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                          <TouchableOpacity onPress={() => { setLastView(view); setView('settings'); }}><MaterialIcons name="settings" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                          <TouchableOpacity onPress={() => { setView('ops'); setLastOpsView('ops'); }}><MaterialIcons name="list" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                      </View>
                  </View>
              </SafeAreaView>
              <View style={{flex: 1}}>
                  <TacticalMap 
                      me={user} peers={peers} pings={pings} mapMode={mapMode} showTrails={showTrails} showPings={showPings} 
                      isHost={user.role === OperatorRole.HOST} userArrowColor={settings.userArrowColor} 
                      pingMode={isPingMode} navTargetId={navTargetId}
                      nightOpsMode={nightOpsMode} 
                      onPing={(loc) => { setTempPingLoc(loc); setShowPingMenu(true); }}
                      onPingMove={handlePingMove} 
                      onPingClick={(id) => { 
                          const p = pings.find(ping => ping.id === id);
                          if (!p) return;
                          if (user.role === OperatorRole.HOST || p.sender === user.callsign) {
                              setEditingPing(p); setPingMsgInput(p.msg); if (p.details) setHostileDetails(p.details);
                          } else { showToast(`Ping de ${p.sender}`, 'info'); }
                      }} 
                      onNavStop={() => setNavTargetId(null)} 
                  />
                  <View style={styles.mapControls}>
                      <TouchableOpacity onPress={() => setMapMode(m => m === 'dark' ? 'light' : m === 'light' ? 'satellite' : 'dark')} style={[styles.mapBtn, nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: '#000'}]}><MaterialIcons name={mapMode === 'dark' ? 'dark-mode' : mapMode === 'light' ? 'light-mode' : 'satellite'} size={24} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => setShowTrails(!showTrails)} style={[styles.mapBtn, nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: '#000'}]}><MaterialIcons name={showTrails ? 'visibility' : 'visibility-off'} size={24} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => setShowPings(!showPings)} style={[styles.mapBtn, nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: '#000'}]}><MaterialIcons name={showPings ? 'location-on' : 'location-off'} size={24} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => setIsPingMode(!isPingMode)} style={[styles.mapBtn, isPingMode ? {backgroundColor: '#dc2626', borderColor: '#f87171'} : null, nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: isPingMode ? '#7f1d1d' : '#000'}]}><MaterialIcons name="ads-click" size={24} color="white" /></TouchableOpacity>
                  </View>
              </View>
          </View>

          <View style={[styles.footer, nightOpsMode && {borderTopColor: '#7f1d1d'}]}>
                <View style={styles.statusRow}>
                  {[OperatorStatus.PROGRESSION, OperatorStatus.CONTACT, OperatorStatus.CLEAR].map(s => (
                      <TouchableOpacity key={s} onPress={() => { setUser(u => ({...u, status:s})); connectivityService.updateUserStatus(s); }} style={[styles.statusBtn, user.status === s ? { backgroundColor: STATUS_COLORS[s], borderColor: 'white' } : null, nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: user.status === s ? '#7f1d1d' : '#000'}]}>
                          <Text style={[styles.statusBtnText, user.status === s ? {color:'white'} : null, nightOpsMode && {color: '#ef4444'}]}>{s}</Text>
                      </TouchableOpacity>
                  ))}
                  <TouchableOpacity onPress={() => setShowQuickMsgModal(true)} style={[styles.statusBtn, {borderColor: '#06b6d4'}, nightOpsMode && {borderColor: '#ef4444'}]}><Text style={[styles.statusBtnText, {color: '#06b6d4'}, nightOpsMode && {color: '#ef4444'}]}>MSG</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setShowQRModal(true)} style={[styles.statusBtn, {borderColor: '#d4d4d8'}, nightOpsMode && {borderColor: '#ef4444'}]}><MaterialIcons name="qr-code-2" size={16} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} /></TouchableOpacity>
              </View>
          </View>
      </View>
  );

  if (!isAppReady) {
      return (
        <View style={{flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center'}}>
            <ActivityIndicator size="large" color="#3b82f6" />
            <StatusBar style="light" />
        </View>
      );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor="#050505" />
      {view === 'settings' ? <SettingsView onClose={() => setView(lastView)} /> : 
       view === 'login' ? (
        <View style={styles.centerContainer}>
          <MaterialIcons name="login" size={80} color="#3b82f6" style={{opacity: 0.8, marginBottom: 30}} />
          <Text style={styles.title}>Tac<Text style={{color: '#3b82f6'}}>Suite</Text></Text>
          <TextInput style={styles.input} placeholder="TRIGRAMME" placeholderTextColor="#52525b" maxLength={6} value={loginInput} onChangeText={setLoginInput} autoCapitalize="characters" />
          <TouchableOpacity onPress={() => {
              if (loginInput.length < 2) return;
              try { AsyncStorage.setItem(CONFIG.TRIGRAM_STORAGE_KEY, loginInput.toUpperCase()); } catch (e) {}
              if (loginInput.toUpperCase() !== settings.username) configService.update({ username: loginInput.toUpperCase() });
              setUser(prev => ({ ...prev, callsign: loginInput.toUpperCase() }));
              setView('menu');
          }} style={styles.loginBtn}><Text style={styles.loginBtnText}>CONNEXION</Text></TouchableOpacity>
          <PrivacyConsentModal onConsentGiven={() => {}} />
        </View>
       ) :
       view === 'menu' ? (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.menuContainer}>
            <View style={{flexDirection: 'row', justifyContent:'space-between', marginBottom: 20}}>
                <Text style={styles.sectionTitle}>MENU PRINCIPAL</Text>
                <TouchableOpacity onPress={() => { setLastView('menu'); setView('settings'); }}><MaterialIcons name="settings" size={24} color="white" /></TouchableOpacity>
            </View>
            {hostId ? (
                <>
                    <TouchableOpacity onPress={() => setView(lastOpsView)} style={[styles.menuCard, {borderColor: '#22c55e'}]}>
                      <MaterialIcons name="map" size={40} color="#22c55e" />
                      <View style={{marginLeft: 20}}><Text style={styles.menuCardTitle}>RETOURNER SESSION</Text><Text style={styles.menuCardSubtitle}>{hostId}</Text></View>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => Alert.alert("Déconnexion", "Quitter ?", [{text:"Non"}, {text:"Oui", onPress:handleLogout}])} style={[styles.menuCard, {borderColor: '#ef4444', marginTop: 20}]}>
                      <MaterialIcons name="logout" size={40} color="#ef4444" />
                      <View style={{marginLeft: 20}}><Text style={[styles.menuCardTitle, {color:'#ef4444'}]}>QUITTER</Text></View>
                    </TouchableOpacity>
                </>
            ) : (
                <>
                    <TouchableOpacity onPress={createSession} style={styles.menuCard}>
                      <MaterialIcons name="add-location-alt" size={40} color="#3b82f6" />
                      <View style={{marginLeft: 20}}><Text style={styles.menuCardTitle}>CRÉER SESSION</Text><Text style={styles.menuCardSubtitle}>Hôte</Text></View>
                    </TouchableOpacity>
                    <View style={styles.divider} />
                    <TextInput style={styles.inputBox} placeholder="ID GROUPE..." placeholderTextColor="#52525b" value={hostInput} onChangeText={setHostInput} autoCapitalize="characters" />
                    <TouchableOpacity onPress={() => joinSession()} style={styles.joinBtn}><Text style={styles.joinBtnText}>REJOINDRE</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => { requestCamera().then(() => setShowScanner(true)); }} style={[styles.joinBtn, {marginTop: 10, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#333'}]}>
                        <Text style={{color: '#71717a'}}>SCANNER QR</Text>
                    </TouchableOpacity>
                </>
            )}
          </View>
        </SafeAreaView>
       ) : renderMainContent()
      }

      {/* MODALES & ELEMENTS FLOTTANTS */}
      <OperatorActionModal visible={!!selectedOperatorId} targetOperator={peers[selectedOperatorId || ''] || null} currentUserRole={user.role} onClose={() => setSelectedOperatorId(null)} onKick={handleOperatorActionKick} onNavigate={handleOperatorActionNavigate} />
      
      <MainCouranteView 
        visible={showLogs} 
        logs={logs} 
        role={user.role} 
        onClose={() => setShowLogs(false)} 
        onAddLog={handleAddLog}
        onDeleteLog={handleDeleteLog}
      />

      <Modal visible={showQuickMsgModal} animationType="fade" transparent>
          <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
              <View style={[styles.modalContent, {backgroundColor: '#18181b', borderWidth: 1, borderColor: '#333', maxHeight: '80%'}]}>
                  <Text style={[styles.modalTitle, {color: '#06b6d4', marginBottom: 15}]}>MESSAGE RAPIDE</Text>
                  <View style={{flexDirection: 'row', marginBottom: 15, width: '100%'}}>
                      <TextInput style={[styles.pingInput, {flex: 1, marginBottom: 0, textAlign: 'left'}]} placeholder="Message libre..." placeholderTextColor="#52525b" value={freeMsgInput} onChangeText={setFreeMsgInput} />
                      <TouchableOpacity onPress={() => { setUser(prev => ({...prev, lastMsg: freeMsgInput})); connectivityService.updateUser({lastMsg: freeMsgInput}); setShowQuickMsgModal(false); setFreeMsgInput(''); showToast("Message envoyé", "success"); }} style={[styles.modalBtn, {backgroundColor: '#06b6d4', marginLeft: 10, flex: 0, width: 50}]}><MaterialIcons name="send" size={20} color="white" /></TouchableOpacity>
                  </View>
                  <FlatList data={quickMessagesList} keyExtractor={(item, index) => index.toString()} renderItem={({item}) => (
                      <TouchableOpacity onPress={() => { setUser(prev => ({...prev, lastMsg: item.includes("Effacer") ? "" : item})); connectivityService.updateUser({lastMsg: item.includes("Effacer") ? "" : item}); setShowQuickMsgModal(false); showToast("Message mis à jour", "info"); }} style={styles.quickMsgItem}><Text style={styles.quickMsgText}>{item}</Text></TouchableOpacity>
                  )} ItemSeparatorComponent={() => <View style={{height: 1, backgroundColor: '#27272a'}} />} />
                  <TouchableOpacity onPress={() => setShowQuickMsgModal(false)} style={[styles.closeBtn, {backgroundColor: '#27272a', marginTop: 15}]}><Text style={{color: '#a1a1aa'}}>ANNULER</Text></TouchableOpacity>
              </View>
          </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showPingMenu} transparent animationType="fade">
          <View style={styles.modalOverlay}>
              <View style={styles.pingMenuContainer}>
                  <Text style={styles.modalTitle}>TYPE DE MARQUEUR</Text>
                  <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 15, justifyContent: 'center'}}>
                      <TouchableOpacity onPress={() => { setCurrentPingType('HOSTILE'); setShowPingMenu(false); setPingMsgInput(''); setHostileDetails({position: tempPingLoc ? `${tempPingLoc.lat.toFixed(5)}, ${tempPingLoc.lng.toFixed(5)}` : '', nature: '', attitude: '', volume: '', armes: '', substances: ''}); setShowPingForm(true); }} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444'}]}><MaterialIcons name="warning" size={30} color="#ef4444" /><Text style={{color: '#ef4444', fontWeight: 'bold', fontSize: 10, marginTop: 5}}>ADVERSAIRE</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => { setCurrentPingType('FRIEND'); setShowPingMenu(false); setPingMsgInput(''); setShowPingForm(true); }} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(34, 197, 94, 0.2)', borderColor: '#22c55e'}]}><MaterialIcons name="shield" size={30} color="#22c55e" /><Text style={{color: '#22c55e', fontWeight: 'bold', fontSize: 10, marginTop: 5}}>AMI</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => { setCurrentPingType('INTEL'); setShowPingMenu(false); setPingMsgInput(''); setShowPingForm(true); }} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(234, 179, 8, 0.2)', borderColor: '#eab308'}]}><MaterialIcons name="visibility" size={30} color="#eab308" /><Text style={{color: '#eab308', fontWeight: 'bold', fontSize: 10, marginTop: 5}}>RENS</Text></TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => setShowPingMenu(false)} style={[styles.closeBtn, {marginTop: 20, backgroundColor: '#27272a'}]}><Text style={{color:'white'}}>ANNULER</Text></TouchableOpacity>
              </View>
          </View>
      </Modal>

      <Modal visible={showPingForm} transparent animationType="slide">
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
              <View style={[styles.modalContent, {width: '90%', maxHeight: '80%'}]}>
                  <Text style={[styles.modalTitle, {color: currentPingType === 'HOSTILE' ? '#ef4444' : currentPingType === 'FRIEND' ? '#22c55e' : '#eab308'}]}>{currentPingType === 'HOSTILE' ? 'ADVERSAIRE' : currentPingType === 'FRIEND' ? 'AMI' : 'RENS'}</Text>
                  <Text style={styles.label}>Message</Text>
                  <TextInput style={styles.pingInput} placeholder="Titre / Info" placeholderTextColor="#52525b" value={pingMsgInput} onChangeText={setPingMsgInput} autoFocus={currentPingType !== 'HOSTILE'} />
                  {currentPingType === 'HOSTILE' && (
                      <ScrollView style={{width: '100%', maxHeight: 300, marginBottom: 10}}>
                          <Text style={[styles.label, {color: '#ef4444', marginTop: 10}]}>Détails Tactiques (Caneva)</Text>
                          <TextInput style={styles.detailInput} placeholder="Position" placeholderTextColor="#52525b" value={hostileDetails.position} onChangeText={t => setHostileDetails({...hostileDetails, position: t})} />
                          <TextInput style={styles.detailInput} placeholder="Nature" placeholderTextColor="#52525b" value={hostileDetails.nature} onChangeText={t => setHostileDetails({...hostileDetails, nature: t})} />
                          <TextInput style={styles.detailInput} placeholder="Attitude" placeholderTextColor="#52525b" value={hostileDetails.attitude} onChangeText={t => setHostileDetails({...hostileDetails, attitude: t})} />
                          <TextInput style={styles.detailInput} placeholder="Volume" placeholderTextColor="#52525b" value={hostileDetails.volume} onChangeText={t => setHostileDetails({...hostileDetails, volume: t})} />
                          <TextInput style={styles.detailInput} placeholder="Armement" placeholderTextColor="#52525b" value={hostileDetails.armes} onChangeText={t => setHostileDetails({...hostileDetails, armes: t})} />
                          <TextInput style={styles.detailInput} placeholder="Substances / Tenue" placeholderTextColor="#52525b" value={hostileDetails.substances} onChangeText={t => setHostileDetails({...hostileDetails, substances: t})} />
                      </ScrollView>
                  )}
                  <View style={{flexDirection: 'row', gap: 10, marginTop: 10}}>
                      <TouchableOpacity onPress={() => setShowPingForm(false)} style={[styles.modalBtn, {backgroundColor: '#27272a'}]}><Text style={{color: 'white'}}>ANNULER</Text></TouchableOpacity>
                      <TouchableOpacity onPress={submitPing} style={[styles.modalBtn, {backgroundColor: '#3b82f6'}]}><Text style={{color: 'white', fontWeight: 'bold'}}>VALIDER</Text></TouchableOpacity>
                  </View>
              </View>
          </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!editingPing} transparent animationType="slide">
          <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, {width: '90%'}]}>
                  <Text style={styles.modalTitle}>MODIFICATION</Text>
                  <TextInput style={styles.pingInput} value={pingMsgInput} onChangeText={setPingMsgInput} />
                  {editingPing?.type === 'HOSTILE' && (
                      <ScrollView style={{width: '100%', maxHeight: 200, marginBottom: 15}}>
                           <TextInput style={styles.detailInput} placeholder="Position" value={hostileDetails.position} onChangeText={t => setHostileDetails({...hostileDetails, position: t})} />
                           <TextInput style={styles.detailInput} placeholder="Nature" value={hostileDetails.nature} onChangeText={t => setHostileDetails({...hostileDetails, nature: t})} />
                           <TextInput style={styles.detailInput} placeholder="Attitude" value={hostileDetails.attitude} onChangeText={t => setHostileDetails({...hostileDetails, attitude: t})} />
                           <TextInput style={styles.detailInput} placeholder="Volume" value={hostileDetails.volume} onChangeText={t => setHostileDetails({...hostileDetails, volume: t})} />
                           <TextInput style={styles.detailInput} placeholder="Armement" value={hostileDetails.armes} onChangeText={t => setHostileDetails({...hostileDetails, armes: t})} />
                           <TextInput style={styles.detailInput} placeholder="Substances" value={hostileDetails.substances} onChangeText={t => setHostileDetails({...hostileDetails, substances: t})} />
                      </ScrollView>
                  )}
                  <View style={{flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 20}}>
                      <TouchableOpacity onPress={deletePing} style={styles.iconBtnDanger}><MaterialIcons name="delete" size={28} color="white" /></TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingPing(null)} style={styles.iconBtnSecondary}><MaterialIcons name="close" size={28} color="white" /></TouchableOpacity>
                      <TouchableOpacity onPress={savePingEdit} style={styles.iconBtnSuccess}><MaterialIcons name="check" size={28} color="white" /></TouchableOpacity>
                  </View>
              </View>
          </View>
      </Modal>

      <Modal visible={showQRModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>MON IDENTITY TAG</Text>
            <QRCode value={hostId || user.id || 'NO_ID'} size={200} />
            <TouchableOpacity onPress={copyToClipboard} style={{marginTop: 20, flexDirection:'row', alignItems:'center', backgroundColor: '#f4f4f5', padding: 10, borderRadius: 8}}>
                <Text style={[styles.qrId, {marginTop: 0, marginRight: 10}]}>{hostId || user.id}</Text>
                <MaterialIcons name="content-copy" size={20} color="#3b82f6" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowQRModal(false)} style={styles.closeBtn}><Text style={styles.closeBtnText}>FERMER</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showScanner} animationType="slide">
        <View style={{flex: 1, backgroundColor: 'black'}}>
          <CameraView 
            style={{flex: 1}} 
            onBarcodeScanned={handleScannerBarCodeScanned} 
            barcodeScannerSettings={{barcodeTypes: ["qr"]}} 
          />
          <TouchableOpacity onPress={() => setShowScanner(false)} style={styles.scannerClose}>
            <MaterialIcons name="close" size={30} color="white" />
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ALERTS ET NOTIFICATIONS FLOTTANTES */}
      {activeNotif && <NavNotification message={`${activeNotif.id ? activeNotif.id + ': ' : ''}${activeNotif.msg}`} type={activeNotif.type} isNightOps={nightOpsMode} onDismiss={() => setActiveNotif(null)} />}
      
      {/* OVERLAY ROUGE POUR NIGHT OPS (EN PLUS DU FILTRE CSS ET DES STYLES) */}
      {nightOpsMode && <View style={styles.nightOpsOverlay} pointerEvents="none" />}
      
      {/* SUPPRESSION DE L'ANCIEN RENDU DE TOAST QUI CAUSAIT L'ERREUR */}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  title: { fontSize: 32, fontWeight: '900', color: 'white', letterSpacing: 5, marginBottom: 50 },
  input: { width: '100%', borderBottomWidth: 2, borderBottomColor: '#27272a', fontSize: 30, color: 'white', textAlign: 'center', padding: 10 },
  loginBtn: { marginTop: 50, width: '100%', backgroundColor: '#2563eb', padding: 20, borderRadius: 16, alignItems: 'center' },
  loginBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
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
  headerTitle: { color: 'white', fontWeight: '900', fontSize: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 16, gap: 12 },
  scannerClose: { position: 'absolute', top: 50, right: 20, padding: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
  toast: { position: 'absolute', top: 50, alignSelf: 'center', backgroundColor: '#1e3a8a', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, zIndex: 9999, elevation: 9999 },
  toastText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  navNotif: { position: 'absolute', top: 100, left: 20, right: 20, borderRadius: 12, borderWidth: 1, padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 15, zIndex: 10000, elevation: 10000 },
  navNotifText: { color: 'white', fontWeight: 'bold', flex: 1, fontSize: 14 },
  mapControls: { position: 'absolute', top: 16, right: 16, gap: 12, zIndex: 2000, elevation: 2000 },
  mapBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#18181b', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  footer: { backgroundColor: '#050505', borderTopWidth: 1, borderTopColor: '#27272a', paddingBottom: 20, zIndex: 2000, elevation: 2000 },
  statusRow: { flexDirection: 'row', padding: 12, gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  statusBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a' },
  statusBtnText: { color: '#71717a', fontSize: 12, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', padding: 30 },
  modalContent: { width: '100%', backgroundColor: '#18181b', padding: 24, borderRadius: 24, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  modalTitle: { fontSize: 18, fontWeight: '900', marginBottom: 20, color: 'white' },
  qrId: { marginTop: 20, fontSize: 10, backgroundColor: '#f4f4f5', padding: 8, borderRadius: 4 },
  closeBtn: { marginTop: 20, backgroundColor: '#2563eb', width: '100%', padding: 16, borderRadius: 12, alignItems: 'center' },
  closeBtnText: { color: 'white', fontWeight: 'bold' },
  pingInput: { width: '100%', backgroundColor: 'black', color: 'white', padding: 16, borderRadius: 12, textAlign: 'center', fontSize: 18, marginBottom: 20, borderWidth: 1, borderColor: '#333' },
  modalBtn: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center' },
  quickMsgItem: { paddingVertical: 15, paddingHorizontal: 10, width: '100%', alignItems: 'center' },
  quickMsgText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  pingMenuContainer: { width: '85%', backgroundColor: '#09090b', borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  pingTypeBtn: { width: 80, height: 80, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  label: { color: '#a1a1aa', fontSize: 12, alignSelf: 'flex-start', marginBottom: 5, marginLeft: 5 },
  detailInput: { width: '100%', backgroundColor: '#000', color: 'white', padding: 12, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  iconBtnDanger: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  iconBtnSecondary: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#52525b', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  iconBtnSuccess: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#22c55e', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  nightOpsOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(127, 29, 29, 0.2)', zIndex: 99999, pointerEvents: 'none' }
});

export default App;
