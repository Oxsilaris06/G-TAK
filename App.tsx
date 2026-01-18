import './polyfills';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  SafeAreaView, Platform, Modal, StatusBar as RNStatusBar, Alert, ScrollView, ActivityIndicator,
  PermissionsAndroid, FlatList, KeyboardAvoidingView, AppState, Image
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import QRCode from 'react-native-qrcode-svg';

// --- CORRECTION ICI ---
// CameraView est maintenant exporté directement depuis 'expo-camera' dans le SDK 51
// On importe "Camera" pour les permissions (Legacy) et "CameraView" pour le scanner (Nouveau)
import { Camera, CameraView } from 'expo-camera'; 

import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Magnetometer } from 'expo-sensors';
import * as SplashScreen from 'expo-splash-screen';
import * as Battery from 'expo-battery';

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
import { NotificationToast } from './components/NotificationToast';
import ComposantOrdreInitial from './components/ComposantOrdreInitial'; 
// import ShinyText from './components/ShinyText'; // RETIRÉ
import LightPillar from './components/LightPillar';

try { SplashScreen.preventAutoHideAsync().catch(() => {}); } catch (e) {}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false, 
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const App: React.FC = () => {
  useKeepAwake();
  
  const [isAppReady, setIsAppReady] = useState(false);
  const [activeNotif, setActiveNotif] = useState<{ id: string, msg: string, type: 'alert' | 'info' | 'success' | 'warning' } | null>(null);
  
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  
  // Initialisation de l'utilisateur avec un ID temporaire si nécessaire, mais on attendra l'event PEER_OPEN pour le confirmer
  const [user, setUser] = useState<UserData>({ 
      id: '', // Sera remplacé par l'ID PeerJS réel
      callsign: '', 
      role: OperatorRole.OPR, 
      status: OperatorStatus.CLEAR, 
      joinedAt: Date.now(), 
      bat: 100, 
      head: 0, 
      lat: 0, 
      lng: 0, 
      lastMsg: '' 
  });

  const [view, setView] = useState<ViewType | 'oi'>('login'); 
  const [lastView, setLastView] = useState<ViewType>('menu'); 
  const [lastOpsView, setLastOpsView] = useState<ViewType>('map');
  const [mapState, setMapState] = useState<{lat: number, lng: number, zoom: number} | undefined>(undefined);
  
  // NOUVEAU : État pour gérer l'affichage des paramètres sans démonter la vue principale
  const [showSettings, setShowSettings] = useState(false);

  const [peers, setPeers] = useState<Record<string, UserData>>({});
  const [pings, setPings] = useState<PingData[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [hostId, setHostId] = useState<string>('');
  
  const pingsRef = useRef(pings);
  const logsRef = useRef(logs);
  const peersRef = useRef(peers);
  const userRef = useRef(user);

  useEffect(() => { pingsRef.current = pings; }, [pings]);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  useEffect(() => { peersRef.current = peers; }, [peers]);
  useEffect(() => { userRef.current = user; }, [user]);

  const [loginInput, setLoginInput] = useState('');
  const [hostInput, setHostInput] = useState('');
  const [mapMode, setMapMode] = useState<'dark' | 'light' | 'satellite' | 'custom'>('satellite');
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
  const [navInfo, setNavInfo] = useState<{dist: string, time: string} | null>(null);

  const [isServicesReady, setIsServicesReady] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'WAITING' | 'OK' | 'ERROR'>('WAITING');
  const lastLocationRef = useRef<any>(null);
  const gpsSubscription = useRef<Location.LocationSubscription | null>(null);
  const magSubscription = useRef<any>(null);

  const showToast = useCallback((msg: string, type: 'info' | 'error' | 'success' | 'warning' = 'info') => {
      setActiveNotif({ id: Date.now().toString(), msg, type });
      if (type === 'alert' || type === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      else if (type === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const bootstrapPermissionsAsync = async () => {
    try {
        if (Platform.OS === 'android') {
            await PermissionsAndroid.requestMultiple([
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
                PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
                PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
                PermissionsAndroid.PERMISSIONS.CAMERA
            ]).catch(() => {});
        }
        
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
            await Location.requestBackgroundPermissionsAsync().catch(() => {});
            setGpsStatus('OK');
        } else {
            setGpsStatus('ERROR');
        }

        const camStatus = await Camera.requestCameraPermissionsAsync();
        setHasCameraPermission(camStatus.status === 'granted');
    } catch (e) {
        console.log("Erreur permissions:", e);
    }
  };

  const triggerTacticalNotification = async (title: string, body: string) => {
      if (AppState.currentState !== 'background' || settings.disableBackgroundNotifications) return;
      await Notifications.dismissAllNotificationsAsync();
      await Notifications.scheduleNotificationAsync({
          content: { 
              title, 
              body, 
              sound: true, 
              priority: Notifications.AndroidNotificationPriority.HIGH 
          },
          trigger: null, 
      });
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async nextAppState => {
      if (nextAppState === 'active') {
        connectivityService.handleAppStateChange('active');
        await Notifications.dismissAllNotificationsAsync();
        startGpsTracking(settings.gpsUpdateInterval);
      } else if (nextAppState === 'background') {
        connectivityService.handleAppStateChange('background');
      }
    });
    return () => subscription.remove();
  }, [settings.gpsUpdateInterval]);

  // Initialisation de l'application
  useEffect(() => {
      let mounted = true;
      const initApp = async () => {
          try {
              const s = await configService.init();
              if (mounted) {
                  setSettings(s);
                  if (s.username) { 
                      setUser(prev => ({...prev, callsign: s.username, paxColor: s.userArrowColor})); 
                      setLoginInput(s.username); 
                  } else {
                      setUser(prev => ({...prev, paxColor: s.userArrowColor}));
                  }
                  
                  setQuickMessagesList(s.quickMessages || DEFAULT_SETTINGS.quickMessages);
                  if (s.customMapUrl) setMapMode('custom');
              }
          } catch(e) {
              console.log("Erreur Config Init:", e);
          }
          
          try {
             await bootstrapPermissionsAsync();
          } catch (e) {
             console.log("Erreur Bootstrap:", e);
          }

          try {
              const level = await Battery.getBatteryLevelAsync();
              if(mounted && level) setUser(u => ({ ...u, bat: Math.round(level * 100) }));
          } catch(e) {}
          
          if (mounted) { 
              setIsAppReady(true); 
              setTimeout(async () => { await SplashScreen.hideAsync().catch(() => {}); }, 500); 
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

      // Abonnement UNIQUE aux événements de connectivité
      const unsubConn = connectivityService.subscribe((event) => {
          handleConnectivityEvent(event);
      });
      
      return () => { 
          mounted = false; 
          unsubConn(); // Désabonnement propre
          battSub.remove(); 
          if(magSubscription.current) magSubscription.current.remove(); 
          // Note: On ne nettoie pas connectivityService ici pour éviter de couper la connexion en changeant de vue si le composant est remonté
      };
  }, []);

  useEffect(() => {
      if (view === 'map' || view === 'ops') { 
          startGpsTracking(settings.gpsUpdateInterval);
          _toggleMagnetometer(); 
      }
      return () => { if(magSubscription.current) magSubscription.current.remove(); }
  }, [view, settings.gpsUpdateInterval, settings.orientationUpdateInterval]);

  const _toggleMagnetometer = async () => {
      if (magSubscription.current) magSubscription.current.remove();
      Magnetometer.setUpdateInterval(settings.orientationUpdateInterval || 500);
      magSubscription.current = Magnetometer.addListener(data => {
          const { x, y } = data;
          let angle = Math.atan2(y, x) * (180 / Math.PI);
          angle = angle - 90;
          if (angle < 0) angle = angle + 360;
          const heading = Math.floor(angle);
          if (Math.abs(heading - userRef.current.head) > 5) {
              setUser(prev => ({ ...prev, head: heading }));
              connectivityService.updateUserPosition(userRef.current.lat, userRef.current.lng, heading);
          }
      });
  };

  const startGpsTracking = useCallback(async (interval: number) => {
      if (gpsSubscription.current) gpsSubscription.current.remove();
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') { setGpsStatus('ERROR'); return; }
        
        gpsSubscription.current = await Location.watchPositionAsync({ 
            accuracy: Location.Accuracy.High, 
            timeInterval: interval, 
            distanceInterval: 2 
        }, (loc) => {
            const { latitude, longitude, heading, speed } = loc.coords;
            setGpsStatus('OK');
            const currentHead = userRef.current.head;
            const gpsHead = (speed && speed > 1 && heading !== null) ? heading : currentHead;
            setUser(prev => {
                if (!lastLocationRef.current || Math.abs(latitude - lastLocationRef.current.lat) > 0.0001 || Math.abs(longitude - lastLocationRef.current.lng) > 0.0001) {
                    connectivityService.updateUserPosition(latitude, longitude, gpsHead);
                    lastLocationRef.current = { lat: latitude, lng: longitude };
                }
                return { ...prev, lat: latitude, lng: longitude, head: gpsHead };
            });
        });
      } catch(e) { setGpsStatus('ERROR'); }
  }, []);

  const handleConnectivityEvent = (event: ConnectivityEvent) => {
      console.log("App Event Received:", event.type); // Debug log essentiel
      switch (event.type) {
          case 'PEER_OPEN': 
              console.log("Peer Open ID:", event.id);
              setUser(prev => ({ ...prev, id: event.id })); 
              setIsServicesReady(true); 
              break;
          case 'PEERS_UPDATED': 
              setPeers(prev => {
                  const incoming = event.peers;
                  const candidates = Object.values({ ...prev, ...incoming });
                  const byCallsign: Record<string, UserData[]> = {};
                  candidates.forEach(p => {
                      if (!byCallsign[p.callsign]) byCallsign[p.callsign] = [];
                      byCallsign[p.callsign].push(p);
                  });
                  const cleanPeers: Record<string, UserData> = {};
                  Object.keys(byCallsign).forEach(sign => {
                      if (sign === userRef.current.callsign) return;
                      const group = byCallsign[sign];
                      group.sort((a, b) => b.joinedAt - a.joinedAt);
                      cleanPeers[group[0].id] = group[0];
                  });
                  return cleanPeers;
              });
              break;
          case 'HOST_CONNECTED': 
              setHostId(event.hostId); 
              showToast("Lien Hôte établi", "success"); 
              break;
          case 'TOAST': showToast(event.msg, event.level as any); break;
          case 'DATA_RECEIVED': handleProtocolData(event.data, event.from); break;
          case 'DISCONNECTED': 
              if (event.reason === 'KICKED') { 
                  Alert.alert("Session Terminée", "Exclu de la session."); 
                  finishLogout(); 
              } else if (event.reason === 'NO_HOST') { 
                  showToast("Recherche Hôte...", "warning"); 
              } 
              break;
          case 'NEW_HOST_PROMOTED': 
              setHostId(event.hostId); 
              if (event.hostId === userRef.current.id) { 
                  setUser(p => ({...p, role: OperatorRole.HOST})); 
                  Alert.alert("Promotion", "Vous êtes le nouveau Chef de Session."); 
              } 
              break;
      }
  };

  const handleProtocolData = (data: any, fromId: string) => {
      const senderName = peersRef.current[fromId]?.callsign || fromId.substring(0,4);
      
      if (data.type === 'HELLO' && user.role === OperatorRole.HOST) {
          connectivityService.sendTo(fromId, { type: 'SYNC_PINGS', pings: pingsRef.current });
          connectivityService.sendTo(fromId, { type: 'SYNC_LOGS', logs: logsRef.current });
      }

      if (data.type === 'PING') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setPings(prev => [...prev, data.ping]);
            const isHostile = data.ping.type === 'HOSTILE';
            showToast(`${senderName}: ${data.ping.msg}`, isHostile ? 'alert' : 'info');
            
            if (isHostile) {
                triggerTacticalNotification(
                    `${senderName} - Contact`, 
                    `Position GPS: ${data.ping.lat.toFixed(5)}, ${data.ping.lng.toFixed(5)}`
                );
            } else {
                 triggerTacticalNotification(`${senderName} - Marqueur`, `${data.ping.msg}`);
            }
      }
      
      else if (data.type === 'LOG_UPDATE' && Array.isArray(data.logs)) {
          const oldLogs = logsRef.current;
          const newEntries = data.logs.filter((l: LogEntry) => !oldLogs.find(ol => ol.id === l.id));
          const hostileEntry = newEntries.find((l: LogEntry) => l.pax.toUpperCase().includes("HOSTILE") || l.paxColor === '#be1b09');
          
          if (hostileEntry) {
              triggerTacticalNotification(
                  "Hote - (PCTAC) : Hostile", 
                  `Lieu: ${hostileEntry.lieu || 'N/C'} - Action: ${hostileEntry.action || 'N/C'} - Rem: ${hostileEntry.remarques || 'RAS'}`
              );
          }
          setLogs(data.logs);
      }
      
      else if ((data.type === 'UPDATE_USER' || data.type === 'UPDATE') && data.user) {
          const u = data.user as UserData;
          const prevStatus = peersRef.current[u.id]?.status;
          const prevMsg = peersRef.current[u.id]?.lastMsg;

          if (u.status === 'CONTACT' && prevStatus !== 'CONTACT') {
              showToast(`${u.callsign} : CONTACT !`, 'alert');
              triggerTacticalNotification(
                  `${u.callsign} - CONTACT`, 
                  `Position GPS: ${u.lat?.toFixed(5) || 'N/A'}, ${u.lng?.toFixed(5) || 'N/A'}`
              );
          }

          if (u.status !== OperatorStatus.CLEAR && u.status !== OperatorStatus.PROGRESSION) {
              if (u.status === OperatorStatus.BUSY && prevStatus !== OperatorStatus.BUSY) {
                  showToast(`${u.callsign} : OCCUPÉ`, 'warning');
              }
          }

          if (u.lastMsg && u.lastMsg !== prevMsg) {
             if(u.lastMsg !== 'RAS / Effacer' && u.lastMsg !== '') {
                 showToast(`${u.callsign}: ${u.lastMsg}`, 'info');
                 triggerTacticalNotification(`${u.callsign} - Message`, u.lastMsg);
             }
          }
      }
      
      else if (data.type === 'SYNC_PINGS') setPings(data.pings);
      else if (data.type === 'SYNC_LOGS') setLogs(data.logs);
      else if (data.type === 'PING_MOVE') setPings(prev => prev.map(p => p.id === data.id ? { ...p, lat: data.lat, lng: data.lng } : p));
      else if (data.type === 'PING_DELETE') setPings(prev => prev.filter(p => p.id !== data.id));
      else if (data.type === 'PING_UPDATE') setPings(prev => prev.map(p => p.id === data.id ? { ...p, msg: data.msg, details: data.details } : p));
  };

  const finishLogout = useCallback(() => {
      connectivityService.cleanup();
      setPeers({}); setPings([]); setLogs([]); setHostId(''); setView('login'); setIsServicesReady(false);
      setUser(prev => ({...prev, id: '', role: OperatorRole.OPR, status: OperatorStatus.CLEAR }));
  }, []);

  const joinSession = async (id?: string) => {
      const finalId = id || hostInput.toUpperCase();
      if (!finalId) return;
      
      setHostId(finalId);
      
      // Préparation de l'utilisateur AVANT l'init
      const userData = { ...user, role: OperatorRole.OPR, paxColor: settings.userArrowColor };
      setUser(userData);
      
      console.log("Joining session as OPR with Host ID:", finalId);
      await connectivityService.init(userData, OperatorRole.OPR, finalId);
      
      setView('map'); setLastOpsView('map');
  };

  const createSession = async () => {
      // Préparation de l'utilisateur AVANT l'init
      const userData = { ...user, role: OperatorRole.HOST, paxColor: settings.userArrowColor };
      setUser(userData);
      
      console.log("Creating session as HOST");
      await connectivityService.init(userData, OperatorRole.HOST);
      
      // En tant qu'hôte, notre propre ID devient le HostID dès que PeerJS est prêt
      // Cela sera géré par l'événement PEER_OPEN dans handleConnectivityEvent
      setView('map'); setLastOpsView('map');
  };

  const handleLogout = () => {
      if (user.role === OperatorRole.HOST) connectivityService.broadcast({ type: 'CLIENT_LEAVING', id: user.id });
      else connectivityService.broadcast({ type: 'CLIENT_LEAVING', id: user.id, callsign: user.callsign });
      finishLogout();
  };

  const handleOperatorActionNavigate = (targetId: string) => { 
      setNavTargetId(targetId); 
      setView('map'); 
      setLastOpsView('map'); 
      showToast("Ralliement activé");
      connectivityService.sendTo(targetId, { type: 'RALLY_REQ', sender: user.callsign });
  };

  const handleOperatorActionKick = (targetId: string) => {
      connectivityService.kickUser(targetId);
      const newPeers = { ...peers }; delete newPeers[targetId]; setPeers(newPeers);
      showToast("Exclu");
  };

  const handleSendQuickMessage = (msg: string) => { setUser(prev => ({ ...prev, lastMsg: msg })); connectivityService.updateUser({ lastMsg: msg }); setShowQuickMsgModal(false); setFreeMsgInput(''); showToast("Message envoyé"); };
  
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
  const handleUpdateLog = (updatedEntry: LogEntry) => {
      setLogs(prev => {
          const newLogs = prev.map(l => l.id === updatedEntry.id ? updatedEntry : l);
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
  
  const requestCamera = async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasCameraPermission(status === 'granted');
  };

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

  useEffect(() => {
      if (navTargetId && peers[navTargetId] && user.lat && peers[navTargetId].lat) {
          const target = peers[navTargetId];
          const R = 6371e3;
          const φ1 = user.lat * Math.PI/180;
          const φ2 = target.lat * Math.PI/180;
          const Δφ = (target.lat-user.lat) * Math.PI/180;
          const Δλ = (target.lng-user.lng) * Math.PI/180;
          const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2)
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          const distM = R * c;
          
          // ARRÊT AUTOMATIQUE DE NAVIGATION SI < 10m
          if (distM < 10) {
              setNavTargetId(null);
              showToast("Arrivé à destination", "success");
              return;
          }

          const speed = 1.4; 
          const seconds = distM / speed;
          const min = Math.round(seconds / 60);
          
          setNavInfo({
              dist: distM > 1000 ? `${(distM/1000).toFixed(1)} km` : `${Math.round(distM)} m`,
              time: min > 60 ? `${Math.floor(min/60)}h ${min%60}min` : `${min} min`
          });
      } else {
          setNavInfo(null);
      }
  }, [navTargetId, user.lat, user.lng, peers]);

  // Nouvelle fonction pour gérer le header avec navigation intégrée
  const renderHeader = () => {
      if (navTargetId && navInfo) {
          return (
              <View style={styles.headerContent}>
                  <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
                      <MaterialIcons name="navigation" size={24} color="#06b6d4" />
                      <View>
                         <Text style={{color:'#06b6d4', fontWeight:'bold', fontSize: 16}}>RALLIEMENT</Text>
                         <Text style={{color:'white', fontSize: 12}}>{peers[navTargetId]?.callsign} - {navInfo.dist} - {navInfo.time}</Text>
                      </View>
                  </View>
                  <TouchableOpacity onPress={() => setNavTargetId(null)} style={{padding: 8}}>
                      <MaterialIcons name="close" size={28} color="white" />
                  </TouchableOpacity>
              </View>
          );
      }
      return (
          <View style={styles.headerContent}>
              <TouchableOpacity onPress={handleBackPress}><MaterialIcons name="arrow-back" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
              <Text style={[styles.headerTitle, nightOpsMode && {color: '#ef4444'}]}>Praxis</Text>
              <View style={{flexDirection: 'row', gap: 15}}>
                  <TouchableOpacity onPress={() => setShowLogs(true)}><MaterialIcons name="history-edu" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => setNightOpsMode(!nightOpsMode)}><MaterialIcons name="nightlight-round" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => setShowSettings(true)}><MaterialIcons name="settings" size={24} color={nightOpsMode ? "#ef4444" : "white"} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => { 
                      if(view === 'map') { setView('ops'); setLastOpsView('ops'); }
                      else { setView('map'); setLastOpsView('map'); }
                  }}>
                      <MaterialIcons name={view === 'map' ? "list" : "map"} size={24} color={nightOpsMode ? "#ef4444" : "white"} />
                  </TouchableOpacity>
              </View>
          </View>
      );
  };

  const renderContent = () => {
    // Note: settings view n'est plus gérée ici pour éviter le démontage
    if (view === 'oi') {
      return <ComposantOrdreInitial onClose={() => setView('login')} />;
    } else if (view === 'login') {
      return (
        <View style={styles.centerContainer}>
          {/* ARRIÈRE PLAN 3D AVEC RÉGLAGES - Conditionné pour n'être affiché que sur login */}
          <LightPillar 
            topColor="#2100a3"
            bottomColor="#021369"
            intensity={0.7}
            glowAmount={0.005}
            pillarWidth={10}
            pillarHeight={1}
            noiseIntensity={0.7}
            pillarRotation={72}
          />

          <TextInput style={styles.input} placeholder="TRIGRAMME" placeholderTextColor="#52525b" maxLength={6} value={loginInput} onChangeText={setLoginInput} autoCapitalize="characters" />
          
          {/* BOUTON PRAXIS STANDARDISÉ ET CENTRÉ */}
          <View style={{ marginTop: 50, width: '100%', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => {
                if (loginInput.length < 2) return;
                try { AsyncStorage.setItem(CONFIG.TRIGRAM_STORAGE_KEY, loginInput.toUpperCase()); } catch (e) {}
                if (loginInput.toUpperCase() !== settings.username) configService.update({ username: loginInput.toUpperCase() });
                setUser(prev => ({ ...prev, callsign: loginInput.toUpperCase(), joinedAt: Date.now() }));
                setView('menu');
              }}
              style={[styles.strategicaBtn, { backgroundColor: 'rgba(0,0,0,0.5)', width: '100%', alignItems: 'center' }]} 
            >
              <Text style={styles.strategicaBtnText}>Praxis</Text>
            </TouchableOpacity>
          </View>
          
          {/* BOUTON STRATEGICA STANDARDISÉ ET CENTRÉ */}
          <View style={{ marginTop: 20, width: '100%', alignItems: 'center' }}>
            <TouchableOpacity 
              onPress={() => setView('oi')}
              style={[styles.strategicaBtn, { width: '100%', alignItems: 'center' }]}
            >
              <Text style={styles.strategicaBtnText}>Stratégica</Text>
            </TouchableOpacity>
          </View>

          <PrivacyConsentModal onConsentGiven={() => {}} />
        </View>
      );
    } else if (view === 'menu') {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.menuContainer}>
            <View style={{flexDirection: 'row', justifyContent:'space-between', marginBottom: 20}}>
                <Text style={styles.sectionTitle}>MENU PRINCIPAL</Text>
                <TouchableOpacity onPress={() => setShowSettings(true)}><MaterialIcons name="settings" size={24} color="white" /></TouchableOpacity>
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
      );
    } else {
      return renderMainContent();
    }
  };

  const renderMainContent = () => (
      <View style={{flex: 1}}>
          <SafeAreaView style={styles.header}>{renderHeader()}</SafeAreaView>

          <View style={{ flex: 1, display: view === 'ops' ? 'flex' : 'none' }}>
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
              <View style={{flex: 1}}>
                  <TacticalMap 
                      me={user} peers={peers} pings={pings} 
                      mapMode={mapMode} customMapUrl={settings.customMapUrl}
                      showTrails={showTrails} showPings={showPings} 
                      isHost={user.role === OperatorRole.HOST} 
                      userArrowColor={settings.userArrowColor}
                      pingMode={isPingMode} navTargetId={navTargetId}
                      nightOpsMode={nightOpsMode} 
                      initialCenter={mapState} 
                      onPing={(loc) => { setTempPingLoc(loc); setShowPingMenu(true); }}
                      onPingMove={(p) => { 
                         setPings(prev => prev.map(pi => pi.id === p.id ? p : pi));
                         connectivityService.broadcast({ type: 'PING_MOVE', id: p.id, lat: p.lat, lng: p.lng });
                      }}
                      onPingClick={(id) => { 
                          const p = pings.find(ping => ping.id === id);
                          if (!p) return;
                          if (p.type === 'HOSTILE') {
                              // Afficher le caneva en lecture (ou pré-rempli pour modification si c'est le sien)
                              setEditingPing(p);
                              setPingMsgInput(p.msg);
                              if (p.details) setHostileDetails(p.details);
                              setCurrentPingType('HOSTILE');
                              setShowPingForm(true); 
                          } else {
                              showToast(`Ping de ${p.sender}`, 'info');
                          }
                      }}
                      onPingLongPress={(id) => {
                          const p = pings.find(ping => ping.id === id);
                          if (!p) return;
                          if (user.role === OperatorRole.HOST || p.sender === user.callsign) {
                             setEditingPing(p); setPingMsgInput(p.msg); if(p.details) setHostileDetails(p.details);
                             // Ici on ouvre la petite modale d'actions (Edit/Delete)
                          }
                      }}
                      onNavStop={() => setNavTargetId(null)} 
                      onMapMoveEnd={(center, zoom) => setMapState({...center, zoom})} 
                  />
                  <View style={styles.mapControls}>
                      <TouchableOpacity onPress={() => setMapMode(m => m === 'custom' ? 'dark' : m === 'dark' ? 'light' : m === 'light' ? 'satellite' : settings.customMapUrl ? 'custom' : 'dark')} style={[styles.mapBtn, nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: '#000'}]}><MaterialIcons name={mapMode === 'dark' ? 'dark-mode' : mapMode === 'light' ? 'light-mode' : mapMode === 'custom' ? 'map' : 'satellite'} size={24} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => setShowTrails(!showTrails)} style={[styles.mapBtn, nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: '#000'}]}><MaterialIcons name={showTrails ? 'visibility' : 'visibility-off'} size={24} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => setShowPings(!showPings)} style={[styles.mapBtn, nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: '#000'}]}><MaterialIcons name={showPings ? 'location-on' : 'location-off'} size={24} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => setIsPingMode(!isPingMode)} style={[styles.mapBtn, isPingMode ? {backgroundColor: '#dc2626', borderColor: '#f87171'} : null, nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: isPingMode ? '#7f1d1d' : '#000'}]}><MaterialIcons name="ads-click" size={24} color="white" /></TouchableOpacity>
                  </View>
              </View>
          </View>

          <View style={[styles.footer, nightOpsMode && {borderTopColor: '#7f1d1d'}]}>
                <View style={styles.statusRow}>
                  {[OperatorStatus.PROGRESSION, OperatorStatus.CONTACT, OperatorStatus.CLEAR].map(s => (
                      <TouchableOpacity key={s} onPress={() => { 
                          setUser(u => ({...u, status:s})); 
                          connectivityService.updateUser({ status: s, paxColor: settings.userArrowColor }); 
                      }} style={[styles.statusBtn, user.status === s ? { backgroundColor: STATUS_COLORS[s], borderColor: 'white' } : null, nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: user.status === s ? '#7f1d1d' : '#000'}]}>
                          <Text style={[styles.statusBtnText, user.status === s ? {color:'white'} : null, nightOpsMode && {color: '#ef4444'}]}>{s}</Text>
                      </TouchableOpacity>
                  ))}
                  <TouchableOpacity onPress={() => setShowQuickMsgModal(true)} style={[styles.statusBtn, {borderColor: '#06b6d4'}, nightOpsMode && {borderColor: '#ef4444'}]}><Text style={[styles.statusBtnText, {color: '#06b6d4'}, nightOpsMode && {color: '#ef4444'}]}>MSG</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setShowQRModal(true)} style={[styles.statusBtn, {borderColor: '#d4d4d8'}, nightOpsMode && {borderColor: '#ef4444'}]}><MaterialIcons name="qr-code-2" size={16} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} /></TouchableOpacity>
              </View>
          </View>
      </View>
  );

  if (!isAppReady) return <View style={{flex: 1, backgroundColor: '#000'}}><ActivityIndicator size="large" color="#2563eb" style={{marginTop: 50}} /></View>;

  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor="#050505" />
      {renderContent()}

      {/* Modal pour les paramètres - Ne démonte pas le reste de l'app */}
      <Modal visible={showSettings} animationType="slide" onRequestClose={() => setShowSettings(false)}>
         <SettingsView 
            onClose={() => setShowSettings(false)} 
            onUpdate={s => { 
                setSettings(s); 
                setUser(u => ({...u, paxColor: s.userArrowColor})); 
                connectivityService.updateUser({paxColor: s.userArrowColor}); 
                if(s.gpsUpdateInterval !== settings.gpsUpdateInterval) startGpsTracking(s.gpsUpdateInterval);
                if(s.orientationUpdateInterval !== settings.orientationUpdateInterval) _toggleMagnetometer();
            }} 
         />
      </Modal>

      <OperatorActionModal visible={!!selectedOperatorId} targetOperator={peers[selectedOperatorId || ''] || null} currentUserRole={user.role} onClose={() => setSelectedOperatorId(null)} onKick={handleOperatorActionKick} onNavigate={handleOperatorActionNavigate} />
      <MainCouranteView visible={showLogs} logs={logs} role={user.role} onClose={() => setShowLogs(false)} onAddLog={handleAddLog} onUpdateLog={handleUpdateLog} onDeleteLog={handleDeleteLog} />
      <Modal visible={showQuickMsgModal} animationType="fade" transparent><KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}><View style={[styles.modalContent, {backgroundColor: '#18181b', borderWidth: 1, borderColor: '#333', maxHeight: '80%'}]}><Text style={[styles.modalTitle, {color: '#06b6d4', marginBottom: 15}]}>MESSAGE RAPIDE</Text><View style={{flexDirection: 'row', marginBottom: 15, width: '100%'}}><TextInput style={[styles.pingInput, {flex: 1, marginBottom: 0, textAlign: 'left'}]} placeholder="Message libre..." placeholderTextColor="#52525b" value={freeMsgInput} onChangeText={setFreeMsgInput} /><TouchableOpacity onPress={() => handleSendQuickMessage(freeMsgInput)} style={[styles.modalBtn, {backgroundColor: '#06b6d4', marginLeft: 10, flex: 0, width: 50}]}><MaterialIcons name="send" size={20} color="white" /></TouchableOpacity></View><FlatList data={quickMessagesList} keyExtractor={(item, index) => index.toString()} renderItem={({item}) => (<TouchableOpacity onPress={() => handleSendQuickMessage(item.includes("Effacer") ? "" : item)} style={styles.quickMsgItem}><Text style={styles.quickMsgText}>{item}</Text></TouchableOpacity>)} ItemSeparatorComponent={() => <View style={{height: 1, backgroundColor: '#27272a'}} />} /><TouchableOpacity onPress={() => setShowQuickMsgModal(false)} style={[styles.closeBtn, {backgroundColor: '#27272a', marginTop: 15}]}><Text style={{color: '#a1a1aa'}}>ANNULER</Text></TouchableOpacity></View></KeyboardAvoidingView></Modal>
      <Modal visible={showPingMenu} transparent animationType="fade"><View style={styles.modalOverlay}><View style={styles.pingMenuContainer}><Text style={styles.modalTitle}>TYPE DE MARQUEUR</Text><View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 15, justifyContent: 'center'}}><TouchableOpacity onPress={() => { setCurrentPingType('HOSTILE'); setShowPingMenu(false); setPingMsgInput(''); setHostileDetails({position: tempPingLoc ? `${tempPingLoc.lat.toFixed(5)}, ${tempPingLoc.lng.toFixed(5)}` : '', nature: '', attitude: '', volume: '', armes: '', substances: ''}); setShowPingForm(true); }} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444'}]}><MaterialIcons name="warning" size={30} color="#ef4444" /><Text style={{color: '#ef4444', fontWeight: 'bold', fontSize: 10, marginTop: 5}}>ADVERSAIRE</Text></TouchableOpacity><TouchableOpacity onPress={() => { setCurrentPingType('FRIEND'); setShowPingMenu(false); setPingMsgInput(''); setShowPingForm(true); }} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(34, 197, 94, 0.2)', borderColor: '#22c55e'}]}><MaterialIcons name="shield" size={30} color="#22c55e" /><Text style={{color: '#22c55e', fontWeight: 'bold', fontSize: 10, marginTop: 5}}>AMI</Text></TouchableOpacity><TouchableOpacity onPress={() => { setCurrentPingType('INTEL'); setShowPingMenu(false); setPingMsgInput(''); setShowPingForm(true); }} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(234, 179, 8, 0.2)', borderColor: '#eab308'}]}><MaterialIcons name="visibility" size={30} color="#eab308" /><Text style={{color: '#eab308', fontWeight: 'bold', fontSize: 10, marginTop: 5}}>RENS</Text></TouchableOpacity></View><TouchableOpacity onPress={() => setShowPingMenu(false)} style={[styles.closeBtn, {marginTop: 20, backgroundColor: '#27272a'}]}><Text style={{color:'white'}}>ANNULER</Text></TouchableOpacity></View></View></Modal>
      <Modal visible={showPingForm} transparent animationType="slide"><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}><View style={[styles.modalContent, {width: '90%', maxHeight: '80%'}]}><Text style={[styles.modalTitle, {color: currentPingType === 'HOSTILE' ? '#ef4444' : currentPingType === 'FRIEND' ? '#22c55e' : '#eab308'}]}>{currentPingType === 'HOSTILE' ? 'ADVERSAIRE' : currentPingType === 'FRIEND' ? 'AMI' : 'RENS'}</Text><Text style={styles.label}>Message</Text><TextInput style={styles.pingInput} placeholder="Titre / Info" placeholderTextColor="#52525b" value={pingMsgInput} onChangeText={setPingMsgInput} autoFocus={currentPingType !== 'HOSTILE'} />{currentPingType === 'HOSTILE' && (<ScrollView style={{width: '100%', maxHeight: 300, marginBottom: 10}}><Text style={[styles.label, {color: '#ef4444', marginTop: 10}]}>Détails Tactiques (Caneva)</Text><TextInput style={styles.detailInput} placeholder="Position" placeholderTextColor="#52525b" value={hostileDetails.position} onChangeText={t => setHostileDetails({...hostileDetails, position: t})} /><TextInput style={styles.detailInput} placeholder="Nature" placeholderTextColor="#52525b" value={hostileDetails.nature} onChangeText={t => setHostileDetails({...hostileDetails, nature: t})} /><TextInput style={styles.detailInput} placeholder="Attitude" placeholderTextColor="#52525b" value={hostileDetails.attitude} onChangeText={t => setHostileDetails({...hostileDetails, attitude: t})} /><TextInput style={styles.detailInput} placeholder="Volume" placeholderTextColor="#52525b" value={hostileDetails.volume} onChangeText={t => setHostileDetails({...hostileDetails, volume: t})} /><TextInput style={styles.detailInput} placeholder="Armement" placeholderTextColor="#52525b" value={hostileDetails.armes} onChangeText={t => setHostileDetails({...hostileDetails, armes: t})} /><TextInput style={styles.detailInput} placeholder="Substances / Tenue" placeholderTextColor="#52525b" value={hostileDetails.substances} onChangeText={t => setHostileDetails({...hostileDetails, substances: t})} /></ScrollView>)}<View style={{flexDirection: 'row', gap: 10, marginTop: 10}}><TouchableOpacity onPress={() => setShowPingForm(false)} style={[styles.modalBtn, {backgroundColor: '#27272a'}]}><Text style={{color: 'white'}}>ANNULER</Text></TouchableOpacity><TouchableOpacity onPress={submitPing} style={[styles.modalBtn, {backgroundColor: '#3b82f6'}]}><Text style={{color: 'white', fontWeight: 'bold'}}>VALIDER</Text></TouchableOpacity></View></View></KeyboardAvoidingView></Modal>
      <Modal visible={!!editingPing && !showPingForm} transparent animationType="slide"><View style={styles.modalOverlay}><View style={[styles.modalContent, {width: '90%'}]}><Text style={styles.modalTitle}>MODIFICATION</Text><TextInput style={styles.pingInput} value={pingMsgInput} onChangeText={setPingMsgInput} />{editingPing?.type === 'HOSTILE' && (<ScrollView style={{width: '100%', maxHeight: 200, marginBottom: 15}}><TextInput style={styles.detailInput} placeholder="Position" value={hostileDetails.position} onChangeText={t => setHostileDetails({...hostileDetails, position: t})} /><TextInput style={styles.detailInput} placeholder="Nature" value={hostileDetails.nature} onChangeText={t => setHostileDetails({...hostileDetails, nature: t})} /><TextInput style={styles.detailInput} placeholder="Attitude" value={hostileDetails.attitude} onChangeText={t => setHostileDetails({...hostileDetails, attitude: t})} /><TextInput style={styles.detailInput} placeholder="Volume" value={hostileDetails.volume} onChangeText={t => setHostileDetails({...hostileDetails, volume: t})} /><TextInput style={styles.detailInput} placeholder="Armement" value={hostileDetails.armes} onChangeText={t => setHostileDetails({...hostileDetails, armes: t})} /><TextInput style={styles.detailInput} placeholder="Substances" value={hostileDetails.substances} onChangeText={t => setHostileDetails({...hostileDetails, substances: t})} /></ScrollView>)}<View style={{flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 20}}><TouchableOpacity onPress={deletePing} style={styles.iconBtnDanger}><MaterialIcons name="delete" size={28} color="white" /></TouchableOpacity><TouchableOpacity onPress={() => setEditingPing(null)} style={styles.iconBtnSecondary}><MaterialIcons name="close" size={28} color="white" /></TouchableOpacity><TouchableOpacity onPress={savePingEdit} style={styles.iconBtnSuccess}><MaterialIcons name="check" size={28} color="white" /></TouchableOpacity></View></View></View></Modal>
      <Modal visible={showQRModal} animationType="slide" transparent><View style={styles.modalOverlay}><View style={styles.modalContent}><Text style={styles.modalTitle}>MON IDENTITY TAG</Text><View style={{padding: 20, backgroundColor: 'white', borderRadius: 10, marginVertical: 20}}><QRCode value={hostId || user.id || 'NO_ID'} size={200} backgroundColor="white" color="black" /></View><TouchableOpacity onPress={copyToClipboard} style={{flexDirection:'row', alignItems:'center', backgroundColor: '#f4f4f5', padding: 10, borderRadius: 8}}><Text style={[styles.qrId, {marginTop: 0, marginRight: 10, color:'black'}]}>{hostId || user.id}</Text><MaterialIcons name="content-copy" size={20} color="#3b82f6" /></TouchableOpacity><TouchableOpacity onPress={() => setShowQRModal(false)} style={styles.closeBtn}><Text style={styles.closeBtnText}>FERMER</Text></TouchableOpacity></View></View></Modal>
      <Modal visible={showScanner} animationType="slide"><View style={{flex: 1, backgroundColor: 'black'}}><CameraView style={{flex: 1}} onBarcodeScanned={handleScannerBarCodeScanned} barcodeScannerSettings={{barcodeTypes: ["qr"]}} /><View style={{position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center'}}><View style={{width: 250, height: 250, borderWidth: 2, borderColor: '#3b82f6', backgroundColor: 'transparent'}} /><Text style={{color: 'white', marginTop: 20, backgroundColor: 'rgba(0,0,0,0.5)', padding: 5}}>Visez le QR Code de l'Hôte</Text></View><TouchableOpacity onPress={() => setShowScanner(false)} style={styles.scannerClose}><MaterialIcons name="close" size={30} color="white" /></TouchableOpacity></View></Modal>

      {activeNotif && <NotificationToast message={activeNotif.msg} type={activeNotif.type} isNightOps={nightOpsMode} onDismiss={() => setActiveNotif(null)} />}
      
      {nightOpsMode && <View style={styles.nightOpsOverlay} pointerEvents="none" />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  title: { fontSize: 32, fontWeight: '900', color: 'white', letterSpacing: 5, marginBottom: 50 },
  input: { 
    width: '100%', 
    borderBottomWidth: 2, 
    borderBottomColor: '#3b82f6', // Bleu pour l'encadré
    borderWidth: 2, // Bordure un peu plus large
    borderColor: '#3b82f6', // Bleu pour l'encadré
    fontSize: 30, 
    color: 'white', 
    textAlign: 'center', 
    padding: 10,
    backgroundColor: 'transparent' // Fond transparent
  },
  loginBtn: { marginTop: 50, width: '100%', backgroundColor: '#2563eb', padding: 20, borderRadius: 16, alignItems: 'center' },
  loginBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  
  // Style pour le bouton Stratégica classique (utilisé aussi pour Praxis)
  strategicaBtn: {
    padding: 10,
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#3b82f6',
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  strategicaBtnText: {
    color: '#3b82f6',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

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
  nightOpsOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(127, 29, 29, 0.2)', zIndex: 99999, pointerEvents: 'none' },
  navModal: { position: 'absolute', top: 80, left: 20, right: 20, backgroundColor: 'rgba(24, 24, 27, 0.95)', borderRadius: 12, padding: 15, borderWidth: 1, borderColor: '#06b6d4', zIndex: 2000 },
  navTitle: { color: '#06b6d4', fontWeight: '900', fontSize: 14 },
  navSubtitle: { color: '#71717a', fontSize: 12 },
  navStat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  navValue: { color: 'white', fontWeight: 'bold', fontSize: 16 }
});

export default App;
