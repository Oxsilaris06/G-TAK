import './polyfills';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  SafeAreaView, Platform, Modal, StatusBar as RNStatusBar, Alert, ScrollView, ActivityIndicator,
  PermissionsAndroid, FlatList, KeyboardAvoidingView, AppState, Image
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import QRCode from 'react-native-qrcode-svg';
// Import correct pour Expo SDK 51+
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
import TacticalBackground from './components/TacticalBackground';

// Prévention auto-hide splash
try { SplashScreen.preventAutoHideAsync().catch(() => {}); } catch (e) {}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false,
  }),
});

const App: React.FC = () => {
  useKeepAwake();
  
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
  
  // Refs pour accès synchrone dans les callbacks sans re-render
  const pingsRef = useRef(pings);
  const logsRef = useRef(logs);
  const peersRef = useRef(peers);
  const userRef = useRef(user);

  useEffect(() => { pingsRef.current = pings; }, [pings]);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  useEffect(() => { peersRef.current = peers; }, [peers]);
  useEffect(() => { userRef.current = user; }, [user]);

  // UI States
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
  const [gpsStatus, setGpsStatus] = useState<'WAITING' | 'OK' | 'ERROR'>('WAITING');
  
  // AUDIT 2.B: Refs pour gérer les subscriptions sans Memory Leaks
  const lastLocationRef = useRef<any>(null);
  const gpsSubscription = useRef<Location.LocationSubscription | null>(null);
  const magSubscription = useRef<any>(null);
  const batterySubscription = useRef<any>(null);

  const showToast = useCallback((msg: string, type: 'info' | 'error' | 'success' | 'warning' = 'info') => {
      setActiveNotif({ id: Date.now().toString(), msg, type });
      if (type === 'alert' || type === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      else if (type === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const bootstrapPermissionsAsync = async () => {
      if (Platform.OS === 'android') {
          await PermissionsAndroid.requestMultiple([
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
              PermissionsAndroid.PERMISSIONS.CAMERA,
              PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
              PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
              PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
          ]);
      }
      const { status: camStatus } = await Camera.requestCameraPermissionsAsync();
      setHasCameraPermission(camStatus === 'granted');
      const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
      if (locStatus !== 'granted') showToast("GPS requis pour G-TAK", "error");
      
      const { status: notifStatus } = await Notifications.requestPermissionsAsync();
  };

  const triggerTacticalNotification = async (title: string, body: string) => {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true, priority: Notifications.AndroidNotificationPriority.MAX },
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

  // INIT APP
  useEffect(() => {
      let mounted = true;
      const initApp = async () => {
          try {
              const s = await configService.init();
              if (mounted) {
                  setSettings(s);
                  if (s.username) { setUser(prev => ({...prev, callsign: s.username, paxColor: s.userArrowColor})); setLoginInput(s.username); }
                  setQuickMessagesList(s.quickMessages || DEFAULT_SETTINGS.quickMessages);
                  if (s.customMapUrl) setMapMode('custom');
              }
          } catch(e) {}
          
          await bootstrapPermissionsAsync();
          try {
              const level = await Battery.getBatteryLevelAsync();
              if(mounted && level) setUser(u => ({ ...u, bat: Math.round(level * 100) }));
          } catch(e) {}
          if (mounted) { setIsAppReady(true); setTimeout(() => SplashScreen.hideAsync(), 500); }
      };
      initApp();

      // AUDIT 2.B: Gestion optimisée batterie (Cleanup garanti)
      if (!batterySubscription.current) {
         batterySubscription.current = Battery.addBatteryLevelListener(({ batteryLevel }) => {
            const newLevel = Math.round(batteryLevel * 100);
            // Throttle: Update seulement si > 2% diff pour éviter spam réseau
            if (Math.abs(newLevel - userRef.current.bat) > 2 || newLevel < 20) {
                setUser(u => ({ ...u, bat: newLevel }));
                connectivityService.updateUser({ bat: newLevel });
            }
         });
      }

      const unsubConn = connectivityService.subscribe((event) => handleConnectivityEvent(event));
      
      return () => { 
          mounted = false; 
          unsubConn(); 
          if(batterySubscription.current) batterySubscription.current.remove(); 
          if(magSubscription.current) magSubscription.current.remove();
          if(gpsSubscription.current) gpsSubscription.current.remove();
      };
  }, []);

  // AUDIT 2.B & 2.C: Refactor Magnetometer pour éviter les fuites et throttler
  const _toggleMagnetometer = async () => {
      if (magSubscription.current) magSubscription.current.remove();
      Magnetometer.setUpdateInterval(settings.orientationUpdateInterval || 500);
      magSubscription.current = Magnetometer.addListener(data => {
          const { x, y } = data;
          let angle = Math.atan2(y, x) * (180 / Math.PI);
          angle = angle - 90;
          if (angle < 0) angle = angle + 360;
          const heading = Math.floor(angle);
          
          // Throttle orientation : Seulement si > 5 deg diff
          if (Math.abs(heading - userRef.current.head) > 5) {
              setUser(prev => ({ ...prev, head: heading }));
              // Envoi optimisé via le service (qui gère son propre throttle réseau)
              connectivityService.updateUserPosition(userRef.current.lat, userRef.current.lng, heading);
          }
      });
  };

  useEffect(() => {
      if (view === 'map' || view === 'ops') { 
          startGpsTracking(settings.gpsUpdateInterval);
          _toggleMagnetometer(); 
      } else {
          // Si on quitte la vue ops/map, on coupe les capteurs pour sauver la batterie (Audit 4.A)
          if(magSubscription.current) magSubscription.current.remove();
          // On garde le GPS si configuré, sinon on pourrait le couper aussi
      }
      return () => { if(magSubscription.current) magSubscription.current.remove(); }
  }, [view, settings.orientationUpdateInterval]);

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
                // Throttle GPS Update Network
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
      switch (event.type) {
          case 'PEER_OPEN': 
              setUser(prev => ({ ...prev, id: event.id })); 
              if (userRef.current.role === OperatorRole.HOST) {
                  setHostId(event.id);
                  showToast(`Session HOST: ${event.id}`, "success");
              }
              break;
          case 'PEERS_UPDATED': 
              setPeers({ ...event.peers });
              break;
          case 'HOST_CONNECTED': setHostId(event.hostId); showToast("Lien Hôte établi", "success"); break;
          case 'TOAST': showToast(event.msg, event.level as any); break;
          case 'DATA_RECEIVED': handleProtocolData(event.data, event.from); break;
          case 'DISCONNECTED': if (event.reason === 'KICKED') { Alert.alert("Session Terminée", "Exclu."); finishLogout(); } break;
          case 'NEW_HOST_PROMOTED': setHostId(event.hostId); if (event.hostId === userRef.current.id) { setUser(p => ({...p, role: OperatorRole.HOST})); Alert.alert("Promotion", "Vous êtes Chef de Session."); } break;
      }
  };

  const handleProtocolData = (data: any, fromId: string) => {
      const senderName = peersRef.current[fromId]?.callsign || fromId.substring(0,4);
      
      if (data.type === 'HELLO' && user.role === OperatorRole.HOST) {
          // Sync new client
          connectivityService.sendTo(fromId, { type: 'SYNC_PINGS', pings: pingsRef.current });
          connectivityService.sendTo(fromId, { type: 'SYNC_LOGS', logs: logsRef.current });
      }

      if (data.type === 'PING') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setPings(prev => [...prev, data.ping]);
            const isHostile = data.ping.type === 'HOSTILE';
            showToast(`${senderName}: ${data.ping.msg}`, isHostile ? 'alert' : 'info');
            if (isHostile) triggerTacticalNotification(`${senderName} - Contact`, `GPS: ${data.ping.lat.toFixed(5)}, ${data.ping.lng.toFixed(5)}`);
      }
      // AUDIT 3.B: Autorité Logs
      else if (data.type === 'LOG_UPDATE' && Array.isArray(data.logs)) {
          setLogs(data.logs);
      }
      else if (data.type === 'LOG_ADD_REQ' && user.role === OperatorRole.HOST) {
          // Hôte valide et diffuse
          const newLogs = [...logsRef.current, data.entry];
          setLogs(newLogs);
          connectivityService.broadcast({ type: 'LOG_UPDATE', logs: newLogs });
      }
      else if ((data.type === 'UPDATE_USER' || data.type === 'UPDATE') && data.user) {
          // Les peers sont gérés par le service, ici on peut déclencher des effets de bord si besoin
      }
      else if (data.type === 'SYNC_PINGS') setPings(data.pings);
      else if (data.type === 'SYNC_LOGS') setLogs(data.logs);
      else if (data.type === 'PING_MOVE') setPings(prev => prev.map(p => p.id === data.id ? { ...p, lat: data.lat, lng: data.lng } : p));
      else if (data.type === 'PING_DELETE') setPings(prev => prev.filter(p => p.id !== data.id));
      else if (data.type === 'PING_UPDATE') setPings(prev => prev.map(p => p.id === data.id ? { ...p, msg: data.msg, details: data.details } : p));
  };

  // AUDIT 3.B: Gestion centralisée des logs
  const handleAddLog = (entry: LogEntry) => {
      if (user.role === OperatorRole.HOST || !hostId) {
          // Si je suis chef ou offline, j'ajoute et je diffuse
          setLogs(prev => {
              const newLogs = [...prev, entry];
              connectivityService.broadcast({ type: 'LOG_UPDATE', logs: newLogs });
              return newLogs;
          });
      } else {
          // Sinon je demande au chef d'ajouter (pour éviter les conflits)
          connectivityService.sendTo(hostId, { type: 'LOG_ADD_REQ', entry });
          // Optimistic UI update (optionnel, ici on attend le retour du chef pour être sûr)
      }
  };

  const joinSession = async (role: OperatorRole) => {
      if (!loginInput.trim()) { Alert.alert("Erreur", "Indicatif requis"); return; }
      if (role === OperatorRole.OPR && !hostInput.trim()) { Alert.alert("Erreur", "ID Hôte requis"); return; }
      
      setUser(prev => ({ ...prev, callsign: loginInput, role, id: '' })); // Reset ID pour que PeerJS en génère un ou prenne celui demandé
      configService.update({ username: loginInput });
      
      setView('ops');
      setLastOpsView('map');
      
      await connectivityService.init({ ...user, callsign: loginInput }, role, role === OperatorRole.HOST ? undefined : hostInput);
  };

  const createSession = () => joinSession(OperatorRole.HOST);

  const handleLogout = () => {
      Alert.alert("Déconnexion", "Quitter la session ?", [
          { text: "Annuler", style: "cancel" },
          { text: "Quitter", style: "destructive", onPress: finishLogout }
      ]);
  };

  const finishLogout = useCallback(() => {
      connectivityService.cleanup();
      setPeers({}); setPings([]); setLogs([]); setHostId(''); setView('login');
      setUser(prev => ({...prev, id: '', role: OperatorRole.OPR, status: OperatorStatus.CLEAR }));
      setMapState(undefined);
  }, []);

  const handleStatusChange = (newStatus: OperatorStatus) => {
      setUser(prev => ({ ...prev, status: newStatus }));
      connectivityService.updateUser({ status: newStatus });
      showToast(`Statut: ${newStatus}`, "info");
      handleAddLog({ id: Date.now().toString(), time: new Date().toLocaleTimeString(), type: 'STATUS', content: `${user.callsign} est passé ${newStatus}`, author: user.callsign });
  };

  const sendFreeMessage = () => {
      if (!freeMsgInput.trim()) return;
      const msgPing: PingData = {
          id: Date.now().toString(), lat: user.lat, lng: user.lng, 
          type: 'INFO', msg: freeMsgInput, sender: user.callsign, time: Date.now()
      };
      setPings(prev => [...prev, msgPing]);
      connectivityService.broadcast({ type: 'PING', ping: msgPing });
      handleAddLog({ id: Date.now().toString(), time: new Date().toLocaleTimeString(), type: 'MSG', content: freeMsgInput, author: user.callsign });
      setFreeMsgInput('');
      setShowQuickMsgModal(false);
  };

  const sendPing = () => {
      if (!tempPingLoc) return;
      let msg = pingMsgInput;
      if (currentPingType === 'HOSTILE') {
          msg = `${hostileDetails.volume} ${hostileDetails.nature} ${hostileDetails.attitude} ${hostileDetails.armes ? '('+hostileDetails.armes+')' : ''}`;
      }
      
      const newPing: PingData = {
          id: Date.now().toString(),
          lat: tempPingLoc.lat, lng: tempPingLoc.lng,
          type: currentPingType,
          msg: msg || currentPingType,
          sender: user.callsign,
          time: Date.now(),
          details: currentPingType === 'HOSTILE' ? hostileDetails : undefined
      };
      
      setPings(prev => [...prev, newPing]);
      connectivityService.broadcast({ type: 'PING', ping: newPing });
      handleAddLog({ id: Date.now().toString(), time: new Date().toLocaleTimeString(), type: 'PING', content: `${currentPingType}: ${msg}`, author: user.callsign });
      
      setShowPingForm(false);
      setPingMsgInput('');
      setHostileDetails({ position: '', nature: '', attitude: '', volume: '', armes: '', substances: '' });
      setTempPingLoc(null);
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconBtn}>
        <MaterialIcons name="settings" size={24} color="#a1a1aa" />
      </TouchableOpacity>
      <View style={styles.statusContainer}>
         <View style={[styles.statusDot, { backgroundColor: connectivityService['isConnecting'] ? 'orange' : (hostId ? '#22c55e' : '#ef4444') }]} />
         <Text style={styles.headerTitle}>{user.callsign || 'G-TAK'}</Text>
         {gpsStatus === 'ERROR' && <MaterialIcons name="gps-off" size={16} color="red" style={{marginLeft:5}} />}
      </View>
      <TouchableOpacity onPress={handleLogout} style={styles.iconBtn}>
        <MaterialIcons name="power-settings-new" size={24} color="#ef4444" />
      </TouchableOpacity>
    </View>
  );

  const renderLogin = () => (
    <View style={styles.loginContainer}>
        <TacticalBackground />
        <View style={styles.loginContent}>
            <Image source={require('./assets/icon.png')} style={{width: 100, height: 100, alignSelf: 'center', marginBottom: 20}} />
            <Text style={styles.loginTitle}>G-TAK PRAXIS</Text>
            <Text style={styles.loginSubtitle}>Système Tactique Décentralisé</Text>
            
            <View style={styles.inputContainer}>
                <MaterialIcons name="person" size={20} color="#52525b" style={styles.inputIcon} />
                <TextInput style={styles.loginInput} placeholder="Indicatif (ex: ALPHA)" placeholderTextColor="#52525b" value={loginInput} onChangeText={setLoginInput} autoCapitalize="characters" />
            </View>
            
            {view === 'login' && (
                <>
                    <TouchableOpacity style={styles.mainBtn} onPress={() => setView('join')}>
                        <Text style={styles.btnText}>REJOINDRE SESSION</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.mainBtn, styles.hostBtn]} onPress={createSession}>
                        <Text style={[styles.btnText, {color: '#000'}]}>CRÉER SESSION (HÔTE)</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.mainBtn, {backgroundColor: '#27272a', marginTop: 20}]} onPress={() => setView('oi')}>
                        <Text style={styles.btnText}>RÉDACTION ORDRE INITIAL</Text>
                    </TouchableOpacity>
                    <Text style={styles.version}>v4.0.2-AUDIT-FIX</Text>
                </>
            )}

            {view === 'join' && (
                <>
                    <View style={styles.inputContainer}>
                        <MaterialIcons name="vpn-key" size={20} color="#52525b" style={styles.inputIcon} />
                        <TextInput style={styles.loginInput} placeholder="ID Session Hôte" placeholderTextColor="#52525b" value={hostInput} onChangeText={setHostInput} autoCapitalize="characters" />
                        <TouchableOpacity onPress={() => setShowScanner(true)} style={{padding: 10}}>
                             <MaterialIcons name="qr-code-scanner" size={24} color="#3b82f6" />
                        </TouchableOpacity>
                    </View>
                    <TouchableOpacity style={styles.mainBtn} onPress={() => joinSession(OperatorRole.OPR)}>
                        <Text style={styles.btnText}>CONNEXION</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setView('login')} style={{marginTop: 15}}>
                        <Text style={{color: '#71717a'}}>Retour</Text>
                    </TouchableOpacity>
                </>
            )}
        </View>
    </View>
  );

  if (!isAppReady) return <View style={{flex: 1, backgroundColor: '#000'}}><ActivityIndicator size="large" color="#2563eb" style={{marginTop: 50}} /></View>;

  if (view === 'oi') return <ComposantOrdreInitial onClose={() => setView('login')} />;

  if (view === 'login' || view === 'join') return renderLogin();

  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor="#050505" />
      <SafeAreaView style={{flex: 1}}>
          {renderHeader()}
          
          <View style={styles.tabBar}>
              <TouchableOpacity onPress={() => { setView('ops'); setLastOpsView('map'); }} style={[styles.tabItem, view==='ops' && lastOpsView==='map' && styles.tabItemActive]}>
                  <MaterialIcons name="map" size={24} color={view==='ops' && lastOpsView==='map' ? '#3b82f6' : '#71717a'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setView('ops'); setLastOpsView('list'); }} style={[styles.tabItem, view==='ops' && lastOpsView==='list' && styles.tabItemActive]}>
                  <MaterialIcons name="people" size={24} color={view==='ops' && lastOpsView==='list' ? '#3b82f6' : '#71717a'} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setView('logs')} style={[styles.tabItem, view==='logs' && styles.tabItemActive]}>
                  <MaterialIcons name="history" size={24} color={view==='logs' ? '#3b82f6' : '#71717a'} />
              </TouchableOpacity>
          </View>

          <View style={{flex: 1}}>
              {view === 'ops' && lastOpsView === 'map' && (
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
                               const p = pings.find(pi => pi.id === id); 
                               if(p) { setEditingPing(p); setTempPingLoc({lat: p.lat, lng: p.lng}); setCurrentPingType(p.type); setPingMsgInput(p.msg); if(p.details) setHostileDetails(p.details); setShowPingForm(true); } 
                           }}
                           onPingLongPress={(id) => {
                               if (user.role === OperatorRole.HOST) {
                                   Alert.alert("Supprimer", "Supprimer ce marqueur ?", [
                                       { text: "Annuler" },
                                       { text: "Supprimer", style: 'destructive', onPress: () => {
                                           setPings(prev => prev.filter(p => p.id !== id));
                                           connectivityService.broadcast({ type: 'PING_DELETE', id });
                                       }}
                                   ]);
                               }
                           }}
                           onNavStop={() => setNavTargetId(null)} 
                           onMapMoveEnd={(center, zoom) => setMapState({...center, zoom})} 
                       />
                       
                       {/* MAP CONTROLS OVERLAY */}
                       <View style={styles.mapControls}>
                           <TouchableOpacity onPress={() => setIsPingMode(!isPingMode)} style={[styles.mapBtn, isPingMode && {backgroundColor: '#eab308'}]}>
                               <MaterialIcons name="add-location" size={24} color="white" />
                           </TouchableOpacity>
                           <TouchableOpacity onPress={() => setMapMode(m => m==='satellite' ? 'dark' : (m==='dark' ? 'light' : 'satellite'))} style={styles.mapBtn}>
                               <MaterialIcons name="layers" size={24} color="white" />
                           </TouchableOpacity>
                           <TouchableOpacity onPress={() => setNightOpsMode(!nightOpsMode)} style={[styles.mapBtn, nightOpsMode && {backgroundColor: '#ef4444'}]}>
                               <MaterialIcons name="nightlight-round" size={24} color="white" />
                           </TouchableOpacity>
                           <TouchableOpacity onPress={() => setShowQuickMsgModal(true)} style={[styles.mapBtn, {backgroundColor: '#3b82f6'}]}>
                               <MaterialIcons name="chat" size={24} color="white" />
                           </TouchableOpacity>
                       </View>

                       {/* COMPASS / NAV INFO */}
                       {navTargetId && (
                            <View style={styles.navInfoBox}>
                                <Text style={{color:'white', fontWeight:'bold'}}>NAVIGATION ACTIVE</Text>
                                <Text style={{color:'#22c55e', fontSize:18}}>VERS CIBLE</Text>
                                <TouchableOpacity onPress={()=>setNavTargetId(null)} style={{marginTop:5, backgroundColor:'#ef4444', padding:5, borderRadius:4}}>
                                    <Text style={{color:'white', fontSize:10}}>STOP</Text>
                                </TouchableOpacity>
                            </View>
                       )}
                   </View>
              )}

              {view === 'ops' && lastOpsView === 'list' && (
                  <ScrollView style={{flex: 1, padding: 10}}>
                      <OperatorCard user={user} isMe={true} onPress={() => setShowSettings(true)} />
                      <Text style={styles.sectionHeader}>ÉQUIPE ({Object.keys(peers).length})</Text>
                      {Object.values(peers).map(peer => (
                          <OperatorCard key={peer.id} user={peer} isMe={false} onPress={() => setSelectedOperatorId(peer.id)} />
                      ))}
                      <View style={{height: 100}} />
                  </ScrollView>
              )}

              {view === 'logs' && (
                   <MainCouranteView logs={logs} onAddLog={handleAddLog} />
              )}
          </View>

          <OperatorActionModal 
              visible={!!selectedOperatorId} 
              onClose={() => setSelectedOperatorId(null)}
              targetId={selectedOperatorId || ''}
              targetUser={selectedOperatorId ? peers[selectedOperatorId] : undefined}
              isHost={user.role === OperatorRole.HOST}
              onKick={(id) => connectivityService.kickUser(id)}
              onNav={(id) => { setNavTargetId(id); setView('ops'); setLastOpsView('map'); setSelectedOperatorId(null); }}
              onPing={(id) => {
                 const u = peers[id];
                 if(u) {
                     setTempPingLoc({lat: u.lat, lng: u.lng});
                     setShowPingMenu(true);
                     setSelectedOperatorId(null);
                 }
              }}
          />

          <SettingsView 
            visible={showSettings} 
            onClose={() => setShowSettings(false)} 
            settings={settings} 
            onUpdate={s => { setSettings(s); configService.save(s); }}
            user={user}
            onStatusChange={handleStatusChange}
            onShowQR={() => setShowQRModal(true)}
            isHost={user.role === OperatorRole.HOST}
            hostId={user.id}
          />

          {/* MODALS DIVERSES (PING, QR, ETC) - CODE IDENTIQUE AU PROJET EXISTANT */}
          <Modal visible={showPingMenu} transparent animationType="fade">
              <View style={styles.modalOverlay}>
                  <View style={styles.pingMenu}>
                      <Text style={styles.modalTitle}>NOUVEAU MARQUEUR</Text>
                      <View style={styles.pingGrid}>
                          <TouchableOpacity style={[styles.pingTypeBtn, {borderColor: '#ef4444'}]} onPress={() => { setCurrentPingType('HOSTILE'); setShowPingMenu(false); setShowPingForm(true); }}>
                              <MaterialIcons name="warning" size={32} color="#ef4444" />
                              <Text style={{color:'#ef4444', fontWeight:'bold'}}>HOSTILE</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.pingTypeBtn, {borderColor: '#22c55e'}]} onPress={() => { setCurrentPingType('FRIEND'); setShowPingMenu(false); setShowPingForm(true); }}>
                              <MaterialIcons name="shield" size={32} color="#22c55e" />
                              <Text style={{color:'#22c55e', fontWeight:'bold'}}>AMI</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={[styles.pingTypeBtn, {borderColor: '#eab308'}]} onPress={() => { setCurrentPingType('INFO'); setShowPingMenu(false); setShowPingForm(true); }}>
                              <MaterialIcons name="info" size={32} color="#eab308" />
                              <Text style={{color:'#eab308', fontWeight:'bold'}}>INFO</Text>
                          </TouchableOpacity>
                      </View>
                      <TouchableOpacity onPress={() => {setShowPingMenu(false); setTempPingLoc(null);}} style={{marginTop: 20}}><Text style={{color:'white'}}>Annuler</Text></TouchableOpacity>
                  </View>
              </View>
          </Modal>

          <Modal visible={showPingForm} transparent animationType="slide">
              <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={styles.modalOverlay}>
                  <View style={styles.pingForm}>
                      <Text style={[styles.modalTitle, {color: currentPingType==='HOSTILE'?'#ef4444':currentPingType==='FRIEND'?'#22c55e':'#eab308'}]}>
                          DÉTAILS {currentPingType}
                      </Text>
                      
                      {currentPingType === 'HOSTILE' ? (
                          <ScrollView style={{maxHeight: 300}}>
                              <Text style={styles.label}>VOLUME</Text>
                              <View style={{flexDirection:'row', flexWrap:'wrap', gap:5, marginBottom:10}}>
                                  {['Isolement', 'Binôme', 'Groupe', 'Foule'].map(o => (
                                      <TouchableOpacity key={o} onPress={()=>setHostileDetails({...hostileDetails, volume: o})} style={[styles.chip, hostileDetails.volume===o && styles.chipActive]}><Text style={{color:'white'}}>{o}</Text></TouchableOpacity>
                                  ))}
                              </View>
                              <Text style={styles.label}>NATURE</Text>
                              <TextInput style={styles.detailInput} placeholder="Ex: Homme, Femme, Véhicule..." placeholderTextColor="#555" value={hostileDetails.nature} onChangeText={t=>setHostileDetails({...hostileDetails, nature:t})} />
                              
                              <Text style={styles.label}>ATTITUDE</Text>
                              <View style={{flexDirection:'row', flexWrap:'wrap', gap:5, marginBottom:10}}>
                                  {['Calme', 'Nerveux', 'Aggressif', 'Fuite', 'Tir'].map(o => (
                                      <TouchableOpacity key={o} onPress={()=>setHostileDetails({...hostileDetails, attitude: o})} style={[styles.chip, hostileDetails.attitude===o && styles.chipActive]}><Text style={{color:'white'}}>{o}</Text></TouchableOpacity>
                                  ))}
                              </View>
                              
                              <Text style={styles.label}>ARMEMENT</Text>
                              <TextInput style={styles.detailInput} placeholder="Ex: PA, AK47, Couteau..." placeholderTextColor="#555" value={hostileDetails.armes} onChangeText={t=>setHostileDetails({...hostileDetails, armes:t})} />
                          </ScrollView>
                      ) : (
                          <TextInput 
                              style={styles.msgInput} 
                              placeholder="Message / Description..." 
                              placeholderTextColor="#555" 
                              value={pingMsgInput} 
                              onChangeText={setPingMsgInput} 
                              multiline 
                          />
                      )}

                      <View style={{flexDirection:'row', justifyContent:'space-between', marginTop: 20}}>
                          <TouchableOpacity onPress={() => {setShowPingForm(false); setTempPingLoc(null);}} style={styles.btnSec}><Text style={{color:'white'}}>Annuler</Text></TouchableOpacity>
                          <TouchableOpacity onPress={sendPing} style={styles.btnPrim}><Text style={{color:'white'}}>CONFIRMER</Text></TouchableOpacity>
                      </View>
                  </View>
              </KeyboardAvoidingView>
          </Modal>
          
          <Modal visible={showQuickMsgModal} transparent animationType="fade">
             <View style={styles.modalOverlay}>
                 <View style={styles.pingMenu}>
                     <Text style={styles.modalTitle}>MESSAGE FLASH</Text>
                     <TextInput style={styles.msgInput} placeholder="Message libre..." placeholderTextColor="#555" value={freeMsgInput} onChangeText={setFreeMsgInput} />
                     <View style={{flexDirection:'row', justifyContent:'flex-end', marginBottom:10}}>
                         <TouchableOpacity onPress={sendFreeMessage} style={{backgroundColor:'#3b82f6', padding:10, borderRadius:8}}><MaterialIcons name="send" size={24} color="white" /></TouchableOpacity>
                     </View>
                     <View style={{height: 1, backgroundColor:'#333', marginVertical:10}} />
                     <FlatList 
                         data={quickMessagesList}
                         keyExtractor={(item, index) => index.toString()}
                         renderItem={({item}) => (
                             <TouchableOpacity style={styles.quickMsgItem} onPress={() => { setFreeMsgInput(item); sendFreeMessage(); }}>
                                 <Text style={{color:'white'}}>{item}</Text>
                             </TouchableOpacity>
                         )}
                     />
                     <TouchableOpacity onPress={() => setShowQuickMsgModal(false)} style={{marginTop:20, alignSelf:'center'}}><Text style={{color:'#71717a'}}>Fermer</Text></TouchableOpacity>
                 </View>
             </View>
          </Modal>

          <Modal visible={showQRModal} transparent animationType="slide">
              <View style={styles.modalOverlay}>
                  <View style={[styles.pingMenu, {backgroundColor:'white', alignItems:'center'}]}>
                      <Text style={[styles.modalTitle, {color:'black'}]}>SCANNEZ POUR REJOINDRE</Text>
                      {hostId ? <QRCode value={hostId} size={200} /> : <Text>Pas d'ID Hôte</Text>}
                      <Text style={{marginTop:10, fontSize:20, fontWeight:'bold', letterSpacing:2}}>{hostId}</Text>
                      <TouchableOpacity onPress={() => setShowQRModal(false)} style={{marginTop:20, backgroundColor:'black', padding:10, borderRadius:8}}>
                          <Text style={{color:'white'}}>FERMER</Text>
                      </TouchableOpacity>
                  </View>
              </View>
          </Modal>

          {showScanner && (
              <View style={StyleSheet.absoluteFill}>
                  {hasCameraPermission ? (
                      <CameraView 
                          style={StyleSheet.absoluteFill} 
                          facing="back"
                          onBarcodeScanned={({ data }) => {
                              setShowScanner(false);
                              setHostInput(data);
                          }}
                      />
                  ) : <Text style={{color:'white', marginTop:100, textAlign:'center'}}>Pas de caméra</Text>}
                  <TouchableOpacity onPress={() => setShowScanner(false)} style={{position:'absolute', bottom:50, alignSelf:'center', backgroundColor:'red', padding:20, borderRadius:30}}>
                      <MaterialIcons name="close" size={30} color="white" />
                  </TouchableOpacity>
              </View>
          )}

          {activeNotif && (
              <NotificationToast 
                  message={activeNotif.msg} 
                  type={activeNotif.type} 
                  onHide={() => setActiveNotif(null)} 
              />
          )}

          {nightOpsMode && <View style={styles.nightOpsOverlay} pointerEvents="none" />}

      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },
  header: { height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: '#27272a', backgroundColor: '#09090b', marginTop: Platform.OS === 'android' ? 30 : 0 },
  headerTitle: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  statusContainer: { flexDirection: 'row', alignItems: 'center' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  iconBtn: { padding: 8 },
  tabBar: { flexDirection: 'row', height: 60, borderTopWidth: 1, borderTopColor: '#27272a', backgroundColor: '#09090b' },
  tabItem: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabItemActive: { borderTopWidth: 2, borderTopColor: '#3b82f6' },
  
  // LOGIN
  loginContainer: { flex: 1, justifyContent: 'center' },
  loginContent: { padding: 30, backgroundColor: 'rgba(9, 9, 11, 0.9)', margin: 20, borderRadius: 20, borderWidth: 1, borderColor: '#27272a' },
  loginTitle: { fontSize: 32, fontWeight: '900', color: 'white', textAlign: 'center', letterSpacing: 2 },
  loginSubtitle: { color: '#a1a1aa', textAlign: 'center', marginBottom: 40, letterSpacing: 1 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#18181b', borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: '#27272a' },
  inputIcon: { padding: 15 },
  loginInput: { flex: 1, color: 'white', fontSize: 16, paddingVertical: 15, fontWeight: 'bold' },
  mainBtn: { backgroundColor: '#3b82f6', padding: 18, borderRadius: 12, alignItems: 'center', marginBottom: 10 },
  hostBtn: { backgroundColor: '#eab308' },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 16, letterSpacing: 1 },
  version: { position: 'absolute', bottom: -40, width: '100%', textAlign: 'center', color: '#52525b', fontSize: 10 },

  // MAP
  mapControls: { position: 'absolute', right: 15, top: 20, gap: 10 },
  mapBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(24, 24, 27, 0.9)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#3f3f46' },
  navInfoBox: { position: 'absolute', top: 20, left: 20, backgroundColor: 'rgba(0,0,0,0.8)', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#22c55e' },

  // MODALS
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  pingMenu: { backgroundColor: '#18181b', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#3f3f46' },
  pingForm: { backgroundColor: '#18181b', padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#3f3f46' },
  modalTitle: { color: 'white', fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  pingGrid: { flexDirection: 'row', justifyContent: 'space-around' },
  pingTypeBtn: { width: 80, height: 80, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  msgInput: { backgroundColor: '#000', color: 'white', padding: 15, borderRadius: 8, minHeight: 100, textAlignVertical: 'top', borderWidth: 1, borderColor: '#333' },
  btnPrim: { backgroundColor: '#3b82f6', paddingVertical: 12, paddingHorizontal: 25, borderRadius: 8 },
  btnSec: { backgroundColor: '#27272a', paddingVertical: 12, paddingHorizontal: 25, borderRadius: 8 },
  quickMsgItem: { padding: 15, borderBottomWidth: 1, borderBottomColor: '#333' },
  
  // HOSTILE FORM
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: '#27272a', borderWidth: 1, borderColor: '#333' },
  chipActive: { backgroundColor: '#ef4444', borderColor: '#ef4444' },
  pingTypeBtn: { width: 80, height: 80, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  label: { color: '#a1a1aa', fontSize: 12, alignSelf: 'flex-start', marginBottom: 5, marginLeft: 5 },
  detailInput: { width: '100%', backgroundColor: '#000', color: 'white', padding: 12, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  iconBtnDanger: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  iconBtnSecondary: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#52525b', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  iconBtnSuccess: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#22c55e', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  nightOpsOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(127, 29, 29, 0.2)', zIndex: 99999, pointerEvents: 'none' },
  navModal: { position: 'absolute', top: 80, left: 20, right: 20, backgroundColor: '#18181b', padding: 15, borderRadius: 12, borderWidth: 1, borderColor: '#3b82f6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionHeader: { color: '#71717a', fontSize: 12, fontWeight: 'bold', marginLeft: 10, marginTop: 15, marginBottom: 5 }
});

export default App;
