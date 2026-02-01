import './polyfills';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  SafeAreaView, Platform, Modal, StatusBar as RNStatusBar, Alert, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, AppState, FlatList, useWindowDimensions, Dimensions
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
import { Magnetometer } from 'expo-sensors';

import { UserData, OperatorStatus, OperatorRole, ViewType, PingData, AppSettings, DEFAULT_SETTINGS, PingType, HostileDetails, LogEntry } from './types';
import { CONFIG, STATUS_COLORS } from './constants';
import { configService } from './services/configService';
import { connectivityService, ConnectivityEvent } from './services/connectivityService'; 
import { locationService } from './services/locationService'; 
import { permissionService } from './services/permissionService'; 

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

try { SplashScreen.preventAutoHideAsync().catch(() => {}); } catch (e) {}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false,
  }),
});

const App: React.FC = () => {
  useKeepAwake();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [isAppReady, setIsAppReady] = useState(false);
  const [activeNotif, setActiveNotif] = useState<{ id: string, msg: string, type: 'alert' | 'info' | 'success' | 'warning' } | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
   
  const [user, setUser] = useState<UserData>({ 
      id: '', callsign: '', role: OperatorRole.OPR, status: OperatorStatus.CLEAR, 
      joinedAt: Date.now(), bat: 100, head: 0, lat: 0, lng: 0, lastMsg: '' 
  });

  const [view, setView] = useState<ViewType | 'oi'>('login'); 
  const [lastView, setLastView] = useState<ViewType>('menu'); 
  const [lastOpsView, setLastOpsView] = useState<ViewType>('map');
  const [mapState, setMapState] = useState<{lat: number, lng: number, zoom: number} | undefined>(undefined);
  const [showSettings, setShowSettings] = useState(false);

  const [peers, setPeers] = useState<Record<string, UserData>>({});
  const [pings, setPings] = useState<PingData[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [hostId, setHostId] = useState<string>('');
   
  const pingsRef = useRef(pings);
  const logsRef = useRef(logs);
  const peersRef = useRef(peers);
  const userRef = useRef(user);
   
  const magSubscription = useRef<any>(null);
  const lastSentHead = useRef<number>(0);

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
  const [navMode, setNavMode] = useState<'pedestrian' | 'vehicle'>('pedestrian'); 

  const [gpsStatus, setGpsStatus] = useState<'WAITING' | 'OK' | 'ERROR'>('WAITING');

  const showToast = useCallback((msg: string, type: 'info' | 'error' | 'success' | 'warning' = 'info') => {
      setActiveNotif({ id: Date.now().toString(), msg, type });
      if (type === 'alert' || type === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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

  // --- Wrapper Broadcast Sécurisé (Patch 10) ---
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
        } catch(e) { console.log("Config Error:", e); }
        
        try {
           const permResult = await permissionService.requestAllPermissions();
           if (!permResult.location) setGpsStatus('ERROR');
           await Camera.requestCameraPermissionsAsync();
        } catch (e) { console.log("Perm Error:", e); }

        try {
            const level = await Battery.getBatteryLevelAsync();
            if(mounted && level) setUser(u => ({ ...u, bat: Math.round(level * 100) }));
        } catch(e) {}
        
        if (mounted) { 
            setIsAppReady(true); 
            setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 500); 
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

    const connSub = connectivityService.subscribe((event) => {
        handleConnectivityEvent(event);
    });
    
    const locSub = locationService.subscribe((loc) => {
        setGpsStatus('OK');
        setUser(prev => ({ ...prev, lat: loc.latitude, lng: loc.longitude }));
        connectivityService.updateUserPosition(loc.latitude, loc.longitude, userRef.current.head);
    });
    
    return () => { 
        mounted = false; connSub(); locSub(); battSub.remove(); appStateSub.remove();
        locationService.stopTracking(); 
        if (magSubscription.current) magSubscription.current.remove();
    };
  }, []);

  useEffect(() => {
      if (view === 'map' || view === 'ops') { 
          locationService.updateOptions({ 
              timeInterval: settings.gpsUpdateInterval,
              foregroundService: {
                  notificationTitle: "PRAXIS",
                  notificationBody: "🛰️ Suivi GPS en arrière plan",
                  notificationColor: "#000000"
              }
          });
          locationService.startTracking();

          if (magSubscription.current) magSubscription.current.remove();
          Magnetometer.setUpdateInterval(100); 
          magSubscription.current = Magnetometer.addListener(data => {
              const { x, y } = data;
              let angle = Math.atan2(y, x) * (180 / Math.PI);
              angle = angle - 90; 
              if (isLandscape) angle = angle + 90; 
              if (angle < 0) angle = angle + 360;
              const heading = Math.floor(angle);
              setUser(prev => ({ ...prev, head: heading }));
              if (Math.abs(heading - lastSentHead.current) > 5) {
                  lastSentHead.current = heading;
                  connectivityService.updateUserPosition(userRef.current.lat, userRef.current.lng, heading);
              }
          });

      } else {
          if (!hostId) locationService.stopTracking();
          if (magSubscription.current) magSubscription.current.remove();
      }
      return () => { if (magSubscription.current) magSubscription.current.remove(); }
  }, [view, settings.gpsUpdateInterval, hostId, isLandscape]);

  const handleConnectivityEvent = (event: ConnectivityEvent) => {
      switch (event.type) {
          case 'PEER_OPEN': 
              setUser(prev => ({ ...prev, id: event.id })); 
              if (userRef.current.role === OperatorRole.HOST) {
                  setHostId(event.id);
                  showToast(`Session: ${event.id}`, "success");
              }
              break;
          case 'PEERS_UPDATED': 
              setPeers(event.peers);
              break;
          case 'HOST_CONNECTED': 
              setHostId(event.hostId); 
              showToast("Lien Hôte établi", "success"); 
              break;
          case 'TOAST': 
              showToast(event.msg, event.level as any); 
              break;
          case 'DATA_RECEIVED': 
              handleProtocolData(event.data, event.from); 
              break;
          case 'DISCONNECTED': 
              if (event.reason === 'KICKED') { 
                  Alert.alert("Fin de Mission", "Vous avez été exclu de la session."); 
                  finishLogout(); 
              } else if (event.reason === 'NO_HOST') { 
                  showToast("Liaison Hôte Perdue...", "warning"); 
              } 
              break;
          case 'RECONNECTING':
               showToast(`Reconnexion réseau (${event.attempt})...`, "warning");
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
        
        if (isHostile) {
            const gpsCoords = `${data.ping.lat.toFixed(5)}, ${data.ping.lng.toFixed(5)}`;
            triggerTacticalNotification(
                `ALERTE PING HOSTILE - ${data.ping.sender}`, 
                `Position: ${gpsCoords} | ${data.ping.msg}`
            );
            showToast(`ENNEMI: ${data.ping.msg} (${gpsCoords})`, 'alert');
        } else {
            showToast(`${senderName}: ${data.ping.msg}`, 'info');
            triggerTacticalNotification(`${senderName} - Info`, `${data.ping.msg}`);
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
              showToast(`${u.callsign} : CONTACT !`, 'alert');
              triggerTacticalNotification(`${u.callsign} - CONTACT`, `Position GPS: ${u.lat?.toFixed(5) || 'N/A'}`);
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
      // PATCH 1 & 9: Suppression du bloc else if (data.type === 'LOG_UPDATE' ...) DUPLIQUÉ
      else if (data.type === 'SYNC_PINGS') setPings(data.pings);
      else if (data.type === 'SYNC_LOGS') setLogs(data.logs);
      else if (data.type === 'PING_MOVE') setPings(prev => prev.map(p => p.id === data.id ? { ...p, lat: data.lat, lng: data.lng } : p));
      else if (data.type === 'PING_DELETE') setPings(prev => prev.filter(p => p.id !== data.id));
      else if (data.type === 'PING_UPDATE') setPings(prev => prev.map(p => p.id === data.id ? { ...p, msg: data.msg, details: data.details } : p));
  };

  const finishLogout = useCallback(() => {
      connectivityService.cleanup();
      locationService.stopTracking(); 
      if (magSubscription.current) {
          magSubscription.current.remove();
          magSubscription.current = null;
      }
      setPeers({}); setPings([]); setLogs([]); setHostId(''); setView('login'); 
      setUser(prev => ({...prev, id: '', role: OperatorRole.OPR, status: OperatorStatus.CLEAR }));
  }, []);

  const joinSession = async (id?: string) => {
      const finalId = id || hostInput.toUpperCase();
      if (!finalId) return;
      
      const role = OperatorRole.OPR;
      const now = Date.now();
      setUser(prev => ({ ...prev, role: role, paxColor: settings.userArrowColor, joinedAt: now }));
      
      try {
          await connectivityService.init({ ...user, role, paxColor: settings.userArrowColor, joinedAt: now }, role, finalId);
          setHostId(finalId);
          setView('map'); 
          setLastOpsView('map');
      } catch (error) {
          console.error("Erreur connexion:", error);
          showToast("Erreur de connexion", "alert");
      }
  };

  const createSession = async () => {
      const role = OperatorRole.HOST;
      const now = Date.now();
      setUser(prev => ({ ...prev, role: role, paxColor: settings.userArrowColor, joinedAt: now }));
      try {
          await connectivityService.init({ ...user, role, paxColor: settings.userArrowColor, joinedAt: now }, role);
          setView('map'); 
          setLastOpsView('map');
      } catch (error) {
          showToast("Erreur création session", "alert");
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

  const handleOperatorActionKick = (targetId: string) => {
      connectivityService.kickUser(targetId);
      const newPeers = { ...peers }; delete newPeers[targetId]; setPeers(newPeers);
      showToast("Opérateur Exclu");
  };

  const handleSendQuickMessage = (msg: string) => { 
      setUser(prev => ({ ...prev, lastMsg: msg })); 
      connectivityService.updateUser({ lastMsg: msg }); 
      setShowQuickMsgModal(false); setFreeMsgInput(''); showToast("Message transmis"); 
  };
   
  // --- PATCH 2: Utilisation de broadcastWithAck pour les pings ---
  const submitPing = async () => {
      if (!tempPingLoc) return;
      const newPing: PingData = {
          id: Math.random().toString(36).substr(2, 9), 
          lat: tempPingLoc.lat, 
          lng: tempPingLoc.lng,
          msg: pingMsgInput || (currentPingType === 'HOSTILE' ? 'ENNEMI' : currentPingType === 'FRIEND' ? 'AMI' : 'OBS'),
          type: currentPingType, 
          sender: user.callsign, 
          timestamp: Date.now(),
          details: currentPingType === 'HOSTILE' ? hostileDetails : undefined
      };
      
      setPings(prev => [...prev, newPing]);
      
      // Utilisation du Wrapper sécurisé avec flag Critique si HOSTILE
      await safeBroadcast({ type: 'PING', ping: newPing }, currentPingType === 'HOSTILE');

      setShowPingForm(false); setTempPingLoc(null); setIsPingMode(false);
  };

  const handlePingMove = (updatedPing: PingData) => {
      setPings(prev => prev.map(p => p.id === updatedPing.id ? updatedPing : p));
      safeBroadcast({ type: 'PING_MOVE', id: updatedPing.id, lat: updatedPing.lat, lng: updatedPing.lng });
  };

  const savePingEdit = () => {
      if (!editingPing) return;
      const updatedPing = { ...editingPing, msg: pingMsgInput, details: editingPing.type === 'HOSTILE' ? hostileDetails : undefined };
      setPings(prev => prev.map(p => p.id === editingPing.id ? updatedPing : p));
      safeBroadcast({ type: 'PING_UPDATE', id: editingPing.id, msg: pingMsgInput, details: updatedPing.details });
      setEditingPing(null);
  };
   
  const deletePing = () => {
      if (!editingPing) return;
      setPings(prev => prev.filter(p => p.id !== editingPing.id));
      safeBroadcast({ type: 'PING_DELETE', id: editingPing.id });
      setEditingPing(null);
  };

  const handleAddLog = (entry: LogEntry) => {
      setLogs(prev => {
          const newLogs = [...prev, entry];
          safeBroadcast({ type: 'LOG_UPDATE', logs: newLogs }); // Logs sont importants mais pas "mission critical" immédiat
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

  const handleScannerBarCodeScanned = ({ data }: any) => {
    setShowScanner(false); setHostInput(data); setTimeout(() => joinSession(data), 500);
  };
  
  const requestCamera = async () => {
      await Camera.requestCameraPermissionsAsync();
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
          const φ1 = user.lat * Math.PI/180;
          const φ2 = target.lat * Math.PI/180;
          const Δφ = (target.lat-user.lat) * Math.PI/180;
          const Δλ = (target.lng-user.lng) * Math.PI/180;
          const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2)
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          const distM = R * c;
          
          if (distM < 10) {
              setNavTargetId(null); showToast("Arrivé à destination", "success"); return;
          }

          const speed = navMode === 'pedestrian' ? 1.4 : 13.8; 
          const seconds = distM / speed;
          const min = Math.round(seconds / 60);
          
          setNavInfo({
              dist: distM > 1000 ? `${(distM/1000).toFixed(1)} km` : `${Math.round(distM)} m`,
              time: min > 60 ? `${Math.floor(min/60)}h ${min%60}min` : `${min} min`
          });
      } else { setNavInfo(null); }
  }, [navTargetId, user.lat, user.lng, peers, navMode]);

  const renderHeader = () => {
      const headerContainerStyle = isLandscapeMap ? styles.headerContentLandscape : styles.headerContent;

      if (navTargetId && navInfo) {
          return (
              <View style={headerContainerStyle}>
                  <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
                      <MaterialIcons name="navigation" size={24} color="#06b6d4" />
                      <View>
                          <Text style={{color:'#06b6d4', fontWeight:'bold', fontSize: 16}}>RALLIEMENT</Text>
                          <Text style={{color:'white', fontSize: 12}}>{peers[navTargetId]?.callsign} - {navInfo.dist} - {navInfo.time}</Text>
                      </View>
                  </View>
                  <View style={{flexDirection:'row', gap: 15, alignItems:'center'}}>
                      <TouchableOpacity onPress={() => setNavMode('pedestrian')} {...getLandscapeProps()} style={getLandscapeStyle()}>
                         <MaterialIcons name="directions-walk" size={26} color={navMode === 'pedestrian' ? '#22c55e' : '#52525b'} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setNavMode('vehicle')} {...getLandscapeProps()} style={getLandscapeStyle()}>
                         <MaterialIcons name="directions-car" size={26} color={navMode === 'vehicle' ? '#22c55e' : '#52525b'} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setNavTargetId(null)} style={[getLandscapeStyle(), {padding: 8, marginLeft: 10}]} {...getLandscapeProps()}>
                          <MaterialIcons name="close" size={28} color="white" />
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
              
              <Text style={[styles.headerTitle, nightOpsMode && {color: '#ef4444'}, isLandscapeMap && {opacity: 0.5}]}>Praxis</Text>
              
              <View style={{flexDirection: 'row', gap: 15}}>
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
                      if(view === 'map') { setView('ops'); setLastOpsView('ops'); }
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
                try { AsyncStorage.setItem(CONFIG.TRIGRAM_STORAGE_KEY, loginInput.toUpperCase()); } catch (e) {}
                if (loginInput.toUpperCase() !== settings.username) configService.update({ username: loginInput.toUpperCase() });
                setUser(prev => ({ ...prev, callsign: loginInput.toUpperCase() }));
                setView('menu');
              }}
              style={[styles.strategicaBtn, { backgroundColor: 'rgba(0,0,0,0.5)', width: '100%', alignItems: 'center' }]} 
            >
              <Text style={styles.strategicaBtnText}>Praxis</Text>
            </TouchableOpacity>
          </View>
          <View style={{ marginTop: 20, width: '100%', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => setView('oi')} style={[styles.strategicaBtn, { width: '100%', alignItems: 'center' }]}>
              <Text style={styles.strategicaBtnText}>Stratégica</Text>
            </TouchableOpacity>
          </View>
          <UpdateNotifier />
          <PrivacyConsentModal onConsentGiven={() => {}} />
        </View>
      );
    } else if (view === 'menu') {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.menuContainer}>
            <View style={{flexDirection: 'row', justifyContent:'space-between', marginBottom: 20}}>
                <Text style={styles.sectionTitle}>Praxis</Text>
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
                        <Text style={{color: '#71717a'}}>SCANNER QR CODE</Text>
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
      <View style={{flex: 1}}>
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
                      isLandscape={isLandscape}
                      maxTrailsPerUser={settings.maxTrailsPerUser}
                      onPing={(loc) => { setTempPingLoc(loc); setShowPingMenu(true); }}
                      onPingMove={(p) => { 
                          handlePingMove(p);
                      }}
                      onPingClick={(id) => { 
                          const p = pings.find(ping => ping.id === id);
                          if (!p) return;
                          setEditingPing(p); 
                          setPingMsgInput(p.msg); 
                          if(p.details) setHostileDetails(p.details);
                      }}
                      onPingLongPress={(id) => {
                          // Handled by WebView
                      }}
                      onNavStop={() => setNavTargetId(null)} 
                      onMapMoveEnd={(center, zoom) => setMapState({...center, zoom})} 
                  />
                  
                  <View style={[styles.mapControls, isLandscapeMap && { top: '50%', right: 16, marginTop: -100 }]}>
                      <TouchableOpacity onPress={() => setMapMode(m => m === 'custom' ? 'dark' : m === 'dark' ? 'light' : m === 'light' ? 'satellite' : m === 'satellite' ? 'hybrid' : settings.customMapUrl ? 'custom' : 'dark')} {...getLandscapeProps()} style={[getLandscapeStyle(styles.mapBtn), nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: '#000'}]}>
                          <MaterialIcons name={mapMode === 'dark' ? 'dark-mode' : mapMode === 'light' ? 'light-mode' : mapMode === 'hybrid' ? 'layers' : mapMode === 'custom' ? 'map' : 'satellite'} size={24} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setShowTrails(!showTrails)} {...getLandscapeProps()} style={[getLandscapeStyle(styles.mapBtn), nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: '#000'}]}>
                          <MaterialIcons name={showTrails ? 'visibility' : 'visibility-off'} size={24} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setShowPings(!showPings)} {...getLandscapeProps()} style={[getLandscapeStyle(styles.mapBtn), nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: '#000'}]}>
                          <MaterialIcons name={showPings ? 'location-on' : 'location-off'} size={24} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setIsPingMode(!isPingMode)} {...getLandscapeProps()} style={[getLandscapeStyle(styles.mapBtn), isPingMode ? {backgroundColor: '#dc2626', borderColor: '#f87171'} : null, nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: isPingMode ? '#7f1d1d' : '#000'}]}>
                          <MaterialIcons name="ads-click" size={24} color="white" />
                      </TouchableOpacity>
                  </View>
              </View>
          </View>

          <View style={[isLandscapeMap ? styles.footerLandscape : styles.footer, nightOpsMode && {borderTopColor: '#7f1d1d'}]}>
                <View style={styles.statusRow}>
                  {[OperatorStatus.PROGRESSION, OperatorStatus.CONTACT, OperatorStatus.CLEAR].map(s => (
                      <TouchableOpacity key={s} onPress={() => { 
                          setUser(u => ({...u, status:s})); 
                          connectivityService.updateUser({ status: s, paxColor: settings.userArrowColor }); 
                      }} {...getLandscapeProps()} style={[getLandscapeStyle(styles.statusBtn), user.status === s ? { backgroundColor: STATUS_COLORS[s], borderColor: 'white' } : null, nightOpsMode && {borderColor: '#7f1d1d', backgroundColor: user.status === s ? '#7f1d1d' : '#000'}]}>
                          <Text style={[styles.statusBtnText, user.status === s ? {color:'white'} : null, nightOpsMode && {color: '#ef4444'}]}>{s}</Text>
                      </TouchableOpacity>
                  ))}
                  <TouchableOpacity onPress={() => setShowQuickMsgModal(true)} {...getLandscapeProps()} style={[getLandscapeStyle(styles.statusBtn), {borderColor: '#06b6d4'}, nightOpsMode && {borderColor: '#ef4444'}]}>
                      <Text style={[styles.statusBtnText, {color: '#06b6d4'}, nightOpsMode && {color: '#ef4444'}]}>MSG</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setShowQRModal(true)} {...getLandscapeProps()} style={[getLandscapeStyle(styles.statusBtn), {borderColor: '#d4d4d8'}, nightOpsMode && {borderColor: '#ef4444'}]}>
                      <MaterialIcons name="qr-code-2" size={16} color={nightOpsMode ? "#ef4444" : "#d4d4d8"} />
                  </TouchableOpacity>
              </View>
          </View>
      </View>
  )};

  if (!isAppReady) return <View style={{flex: 1, backgroundColor: '#000'}}><ActivityIndicator size="large" color="#2563eb" style={{marginTop: 50}} /></View>;

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
                setUser(u => ({...u, paxColor: s.userArrowColor})); 
                connectivityService.updateUser({paxColor: s.userArrowColor}); 
                if(s.gpsUpdateInterval !== settings.gpsUpdateInterval) {
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
                backgroundColor: '#18181b', borderWidth: 1, borderColor: '#333',
                width: isLandscape ? '100%' : '90%', 
                height: '80%', 
                maxHeight: isLandscape ? '100%' : '80%',
                borderRadius: isLandscape ? 0 : 24,
                justifyContent: 'space-between', paddingBottom: 10
            }]}>
                <Text style={[styles.modalTitle, {color: '#06b6d4', marginBottom: 5}]}>MESSAGE RAPIDE</Text>
                
                <View style={{flex: 1, width: '100%', marginBottom: 10}}>
                    <FlatList 
                        data={quickMessagesList} 
                        keyExtractor={(item, index) => index.toString()} 
                        numColumns={isLandscape ? 2 : 1}
                        renderItem={({item}) => (
                            <TouchableOpacity onPress={() => handleSendQuickMessage(item.includes("Effacer") ? "" : item)} style={[styles.quickMsgItem, isLandscape && {flex: 1, margin: 5, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8}]}>
                                <Text style={styles.quickMsgText}>{item}</Text>
                            </TouchableOpacity>
                        )} 
                        style={{width: '100%'}}
                        contentContainerStyle={{paddingBottom: 20}}
                    />
                </View>

                <View style={{flexDirection: 'row', marginBottom: 10, width: '100%', paddingHorizontal: 5}}>
                    <TextInput style={[styles.pingInput, {flex: 1, marginBottom: 0, textAlign: 'left'}]} placeholder="Message libre..." placeholderTextColor="#52525b" value={freeMsgInput} onChangeText={setFreeMsgInput} />
                    <TouchableOpacity onPress={() => handleSendQuickMessage(freeMsgInput)} style={[styles.modalBtn, {backgroundColor: '#06b6d4', marginLeft: 10, flex: 0, width: 50}]}>
                        <MaterialIcons name="send" size={20} color="white" />
                    </TouchableOpacity>
                </View>
                
                <TouchableOpacity onPress={() => setShowQuickMsgModal(false)} style={[styles.closeBtn, {backgroundColor: '#27272a', marginTop: 0, width: '100%'}]}>
                    <Text style={{color: '#a1a1aa'}}>ANNULER</Text>
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showPingMenu} transparent animationType="fade"><View style={styles.modalOverlay}><View style={styles.pingMenuContainer}><Text style={styles.modalTitle}>TYPE DE MARQUEUR</Text><View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 15, justifyContent: 'center'}}><TouchableOpacity onPress={() => { setCurrentPingType('HOSTILE'); setShowPingMenu(false); setPingMsgInput(''); setHostileDetails({position: tempPingLoc ? `${tempPingLoc.lat.toFixed(5)}, ${tempPingLoc.lng.toFixed(5)}` : '', nature: '', attitude: '', volume: '', armes: '', substances: ''}); setShowPingForm(true); }} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444'}]}><MaterialIcons name="warning" size={30} color="#ef4444" /><Text style={{color: '#ef4444', fontWeight: 'bold', fontSize: 10, marginTop: 5}}>ADVERSAIRE</Text></TouchableOpacity><TouchableOpacity onPress={() => { setCurrentPingType('FRIEND'); setShowPingMenu(false); setPingMsgInput(''); setShowPingForm(true); }} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(34, 197, 94, 0.2)', borderColor: '#22c55e'}]}><MaterialIcons name="shield" size={30} color="#22c55e" /><Text style={{color: '#22c55e', fontWeight: 'bold', fontSize: 10, marginTop: 5}}>AMI</Text></TouchableOpacity><TouchableOpacity onPress={() => { setCurrentPingType('INTEL'); setShowPingMenu(false); setPingMsgInput(''); setShowPingForm(true); }} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(234, 179, 8, 0.2)', borderColor: '#eab308'}]}><MaterialIcons name="visibility" size={30} color="#eab308" /><Text style={{color: '#eab308', fontWeight: 'bold', fontSize: 10, marginTop: 5}}>RENS</Text></TouchableOpacity></View><TouchableOpacity onPress={() => setShowPingMenu(false)} style={[styles.closeBtn, {marginTop: 20, backgroundColor: '#27272a'}]}><Text style={{color:'white'}}>ANNULER</Text></TouchableOpacity></View></View></Modal>
      
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
                
                <ScrollView 
                    style={styles.modalBody} 
                    contentContainerStyle={styles.modalBodyContent}
                    keyboardShouldPersistTaps="handled"
                >
                    <Text style={styles.label}>{currentPingType === 'HOSTILE' ? 'Message Principal' : currentPingType === 'FRIEND' ? 'Ami' : 'Info'}</Text>
                    <TextInput 
                        style={styles.pingInput} 
                        placeholder={currentPingType === 'HOSTILE' ? "Titre / Information" : currentPingType === 'FRIEND' ? "Détails Ami..." : "Détails Renseignement..."} 
                        placeholderTextColor="#52525b" 
                        value={pingMsgInput} 
                        onChangeText={setPingMsgInput} 
                        autoFocus={currentPingType !== 'HOSTILE'} 
                    />
                    
                    {currentPingType === 'HOSTILE' && (
                        <View style={{width: '100%'}}>
                            <Text style={[styles.label, {color: '#ef4444', marginTop: 10, marginBottom: 10}]}>Canevas Tactique (SALUTA)</Text>
                            <View style={styles.canevaContainer}>
                                <View style={styles.canevaRow}>
                                    <TextInput style={styles.detailInputHalf} placeholder="Position" placeholderTextColor="#52525b" value={hostileDetails.position} onChangeText={t => setHostileDetails({...hostileDetails, position: t})} />
                                    <TextInput style={styles.detailInputHalf} placeholder="Nature" placeholderTextColor="#52525b" value={hostileDetails.nature} onChangeText={t => setHostileDetails({...hostileDetails, nature: t})} />
                                </View>
                                <View style={styles.canevaRow}>
                                    <TextInput style={styles.detailInputHalf} placeholder="Attitude" placeholderTextColor="#52525b" value={hostileDetails.attitude} onChangeText={t => setHostileDetails({...hostileDetails, attitude: t})} />
                                    <TextInput style={styles.detailInputHalf} placeholder="Volume" placeholderTextColor="#52525b" value={hostileDetails.volume} onChangeText={t => setHostileDetails({...hostileDetails, volume: t})} />
                                </View>
                                <View style={styles.canevaRow}>
                                    <TextInput style={styles.detailInputHalf} placeholder="Armement" placeholderTextColor="#52525b" value={hostileDetails.armes} onChangeText={t => setHostileDetails({...hostileDetails, armes: t})} />
                                    <TextInput style={styles.detailInputHalf} placeholder="Substances / Tenue" placeholderTextColor="#52525b" value={hostileDetails.substances} onChangeText={t => setHostileDetails({...hostileDetails, substances: t})} />
                                </View>
                            </View>
                        </View>
                    )}
                </ScrollView>

                <View style={styles.modalFooter}>
                    <TouchableOpacity onPress={() => setShowPingForm(false)} style={[styles.modalBtn, {backgroundColor: '#27272a'}]}>
                        <Text style={{color: 'white'}}>ANNULER</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={submitPing} style={[styles.modalBtn, {backgroundColor: '#3b82f6'}]}>
                        <Text style={{color: 'white', fontWeight: 'bold'}}>VALIDER</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </KeyboardAvoidingView>
      </Modal>
      
      <Modal visible={!!editingPing && !showPingForm} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
            <View style={[styles.modalContent, isLandscape && styles.modalContentLandscape, { height: '80%' }]}>
                <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, {marginBottom: 5}]}>MODIFICATION</Text>
                    <Text style={{color: '#71717a', fontSize: 12}}>Émis par : <Text style={{fontWeight:'bold', color:'white'}}>{editingPing?.sender}</Text></Text>
                </View>
                
                <ScrollView 
                    style={styles.modalBody} 
                    contentContainerStyle={styles.modalBodyContent}
                    keyboardShouldPersistTaps="handled"
                >
                    <Text style={styles.label}>Titre / Message</Text>
                    <TextInput style={styles.pingInput} value={pingMsgInput} onChangeText={setPingMsgInput} />
                    
                    {editingPing?.type === 'HOSTILE' && (
                        <View style={{width: '100%'}}>
                            <Text style={[styles.label, {color: '#ef4444', marginTop: 10, marginBottom: 10}]}>Canevas Tactique</Text>
                            <View style={styles.canevaContainer}>
                                <View style={styles.canevaRow}>
                                    <TextInput style={styles.detailInputHalf} placeholder="Position" value={hostileDetails.position} onChangeText={t => setHostileDetails({...hostileDetails, position: t})} />
                                    <TextInput style={styles.detailInputHalf} placeholder="Nature" value={hostileDetails.nature} onChangeText={t => setHostileDetails({...hostileDetails, nature: t})} />
                                </View>
                                <View style={styles.canevaRow}>
                                    <TextInput style={styles.detailInputHalf} placeholder="Attitude" value={hostileDetails.attitude} onChangeText={t => setHostileDetails({...hostileDetails, attitude: t})} />
                                    <TextInput style={styles.detailInputHalf} placeholder="Volume" value={hostileDetails.volume} onChangeText={t => setHostileDetails({...hostileDetails, volume: t})} />
                                </View>
                                <View style={styles.canevaRow}>
                                    <TextInput style={styles.detailInputHalf} placeholder="Armement" value={hostileDetails.armes} onChangeText={t => setHostileDetails({...hostileDetails, armes: t})} />
                                    <TextInput style={styles.detailInputHalf} placeholder="Substances" value={hostileDetails.substances} onChangeText={t => setHostileDetails({...hostileDetails, substances: t})} />
                                </View>
                            </View>
                        </View>
                    )}
                </ScrollView>

                <View style={styles.modalFooter}>
                    <TouchableOpacity onPress={deletePing} style={[styles.modalBtn, {backgroundColor: '#ef4444'}]}>
                        <Text style={{color: 'white'}}>SUPPRIMER</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setEditingPing(null)} style={[styles.modalBtn, {backgroundColor: '#52525b'}]}>
                        <Text style={{color: 'white'}}>ANNULER</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={savePingEdit} style={[styles.modalBtn, {backgroundColor: '#22c55e'}]}>
                        <Text style={{color: 'white'}}>VALIDER</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </KeyboardAvoidingView>
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
                        flexDirection:'row', alignItems:'center', backgroundColor: '#f4f4f5', padding: 10, borderRadius: 8,
                        marginLeft: isLandscape ? 20 : 0
                    }}>
                        <Text style={[styles.qrId, {marginTop: 0, marginRight: 10, color:'black'}]}>{hostId || user.id}</Text>
                        <MaterialIcons name="content-copy" size={20} color="#3b82f6" />
                    </TouchableOpacity>
                </View>

                <TouchableOpacity onPress={() => setShowQRModal(false)} style={[styles.closeBtn, {marginTop: isLandscape ? 20 : 20, width: isLandscape ? '100%' : '100%'}]}>
                    <Text style={styles.closeBtnText}>FERMER</Text>
                </TouchableOpacity>
            </View>
        </View>
      </Modal>

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
  input: { width: '100%', borderBottomWidth: 2, borderBottomColor: '#3b82f6', borderWidth: 2, borderColor: '#3b82f6', fontSize: 30, color: 'white', textAlign: 'center', padding: 10, backgroundColor: 'transparent' },
  loginBtn: { marginTop: 50, width: '100%', backgroundColor: '#2563eb', padding: 20, borderRadius: 16, alignItems: 'center' },
  loginBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  strategicaBtn: { padding: 10, marginTop: 20, borderWidth: 1, borderColor: '#3b82f6', borderRadius: 8, backgroundColor: 'transparent' },
  strategicaBtnText: { color: '#3b82f6', fontSize: 16, fontWeight: 'bold', letterSpacing: 2, textTransform: 'uppercase' },
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
  mapBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#18181b', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  
  footer: { backgroundColor: '#050505', borderTopWidth: 1, borderTopColor: '#27272a', paddingBottom: 20, zIndex: 2000, elevation: 2000 },
  
  footerLandscape: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'transparent', zIndex: 2000, paddingBottom: 10, borderTopWidth: 0 },
  
  statusRow: { flexDirection: 'row', padding: 12, gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  statusBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a' },
  statusBtnText: { color: '#71717a', fontSize: 12, fontWeight: 'bold' },
  
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
      gap: 10,
      justifyContent: 'space-around'
  },
  
  modalTitle: { fontSize: 18, fontWeight: '900', color: 'white' },
  qrId: { marginTop: 20, fontSize: 10, backgroundColor: '#f4f4f5', padding: 8, borderRadius: 4 },
  closeBtn: { marginTop: 20, backgroundColor: '#2563eb', width: '100%', padding: 16, borderRadius: 12, alignItems: 'center' },
  closeBtnText: { color: 'white', fontWeight: 'bold' },
  
  pingInput: { width: '100%', backgroundColor: 'black', color: 'white', padding: 16, borderRadius: 12, textAlign: 'center', fontSize: 18, marginBottom: 10, borderWidth: 1, borderColor: '#333', minHeight: 50 },
  
  modalBtn: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center' },
  quickMsgItem: { paddingVertical: 20, paddingHorizontal: 15, width: '100%', alignItems: 'center' },
  quickMsgText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  pingMenuContainer: { width: '85%', backgroundColor: '#09090b', borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  pingTypeBtn: { width: 80, height: 80, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  
  label: { color: '#a1a1aa', fontSize: 12, alignSelf: 'flex-start', marginBottom: 5, marginLeft: 5, fontWeight: 'bold' },
  
  canevaContainer: { width: '100%', gap: 10 },
  canevaRow: { flexDirection: 'row', gap: 10, justifyContent: 'space-between', width: '100%' },
  detailInput: { width: '100%', backgroundColor: '#000', color: 'white', padding: 12, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#333', minHeight: 50, fontSize: 16 },
  detailInputHalf: { flex: 1, backgroundColor: '#000', color: 'white', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#333', minHeight: 50, fontSize: 16 },
  
  iconBtnDanger: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  iconBtnSecondary: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#52525b', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  iconBtnSuccess: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#22c55e', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  
  nightOpsOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(127, 29, 29, 0.2)', zIndex: 99999, pointerEvents: 'none' },
  readOnlyRow: { flexDirection: 'row', width: '100%', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#333' },
  readOnlyLabel: { width: 50, color: '#71717a', fontWeight: 'bold', fontSize: 12 },
  readOnlyVal: { flex: 1, color: 'white', fontSize: 12 }
});

export default App;
