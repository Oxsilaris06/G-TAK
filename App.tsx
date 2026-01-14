import './polyfills'; 
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  SafeAreaView, Platform, Modal, StatusBar as RNStatusBar, Alert, BackHandler, ScrollView, ActivityIndicator,
  PermissionsAndroid, Animated, PanResponder, FlatList
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import QRCode from 'react-native-qrcode-svg';

// FIX: For SDK 50, the new CameraView API is in 'expo-camera/next'
import { CameraView, useCameraPermissions } from 'expo-camera/next'; 

import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import * as Battery from 'expo-battery';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Magnetometer } from 'expo-sensors';
import NetInfo from '@react-native-community/netinfo';

import { UserData, OperatorStatus, OperatorRole, ViewType, PingData, AppSettings, DEFAULT_SETTINGS } from './types';
import { CONFIG, STATUS_COLORS } from './constants';
import { configService } from './services/configService';
import { connectivityService, ConnectivityEvent } from './services/connectivityService'; 

import OperatorCard from './components/OperatorCard';
import TacticalMap from './components/TacticalMap';
import SettingsView from './components/SettingsView';

// --- COMPOSANT NOTIFICATION SWIPABLE ---
const NavNotification = ({ message, onDismiss }: { message: string, onDismiss: () => void }) => {
    const pan = useRef(new Animated.ValueXY()).current;
    
    const panResponder = useRef(
      PanResponder.create({
        onMoveShouldSetPanResponder: () => true,
        onPanResponderMove: Animated.event([null, { dx: pan.x }], { useNativeDriver: false }),
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) > 100) {
              Animated.timing(pan, { toValue: { x: gesture.dx > 0 ? 500 : -500, y: 0 }, useNativeDriver: false, duration: 200 }).start(onDismiss);
          } else {
              Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
          }
        }
      })
    ).current;
  
    return (
      <Animated.View 
        style={[styles.navNotif, { transform: [{ translateX: pan.x }] }]} 
        {...panResponder.panHandlers}
      >
          <MaterialIcons name="directions-run" size={24} color="#06b6d4" />
          <Text style={styles.navNotifText}>{message}</Text>
          <MaterialIcons name="chevron-right" size={20} color="#52525b" />
      </Animated.View>
    );
};

const App: React.FC = () => {
  useKeepAwake();
  
  const [permission, requestPermission] = useCameraPermissions 
    ? useCameraPermissions() 
    : [{ granted: false, canAskAgain: true }, async () => ({ granted: false })];

  // --- CONFIGURATION ---
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const [user, setUser] = useState<UserData>({
    id: '', callsign: '', role: OperatorRole.OPR,
    status: OperatorStatus.CLEAR,
    joinedAt: Date.now(), bat: 100, head: 0,
    lat: 0, lng: 0 
  });

  const [view, setView] = useState<ViewType>('login');
  const [lastView, setLastView] = useState<ViewType>('menu'); 

  const [peers, setPeers] = useState<Record<string, UserData>>({});
  const [pings, setPings] = useState<PingData[]>([]);
  
  const [hostId, setHostId] = useState<string>('');
  const [loginInput, setLoginInput] = useState('');
  const [hostInput, setHostInput] = useState('');
  const [pingMsgInput, setPingMsgInput] = useState('');

  const [mapMode, setMapMode] = useState<'dark' | 'light' | 'satellite'>('satellite');
  const [showTrails, setShowTrails] = useState(true);
  const [showPings, setShowPings] = useState(true);
  const [isPingMode, setIsPingMode] = useState(false);
  
  const [showQRModal, setShowQRModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showPingModal, setShowPingModal] = useState(false);
  const [showQuickMsgModal, setShowQuickMsgModal] = useState(false);
  const [quickMessagesList, setQuickMessagesList] = useState<string[]>([]);

  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null);
  const [tempPingLoc, setTempPingLoc] = useState<any>(null);

  const [privatePeerId, setPrivatePeerId] = useState<string | null>(null);

  const [navTargetId, setNavTargetId] = useState<string | null>(null);
  const [incomingNavNotif, setIncomingNavNotif] = useState<string | null>(null);

  const [hasConsent, setHasConsent] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [isServicesReady, setIsServicesReady] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'WAITING' | 'OK' | 'ERROR'>('WAITING');
  const [isMigrating, setIsMigrating] = useState(false);

  const lastLocationRef = useRef<any>(null);
  const lastHeadBroadcast = useRef<number>(0);
  const gpsSubscription = useRef<Location.LocationSubscription | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null);

  // --- INIT GLOBAL & SERVICES ---
  useEffect(() => {
      configService.init().then(s => {
          setSettings(s);
          setQuickMessagesList(s.quickMessages || DEFAULT_SETTINGS.quickMessages);
          if (s.username) {
            setUser(prev => ({ ...prev, callsign: s.username }));
            setLoginInput(s.username);
          }
      });

      const unsubConfig = configService.subscribe((newSettings) => {
          setSettings(newSettings);
          if (newSettings.quickMessages) setQuickMessagesList(newSettings.quickMessages);
          if (newSettings.username && newSettings.username !== user.callsign) {
              connectivityService.updateUser({ callsign: newSettings.username });
              setUser(prev => ({ ...prev, callsign: newSettings.username }));
          }
          if (gpsSubscription.current) startGpsTracking(newSettings.gpsUpdateInterval);
      });

      const unsubConn = connectivityService.subscribe(handleConnectivityEvent);

      return () => {
          unsubConfig();
          unsubConn();
      };
  }, []); 

  // --- GESTION ÉVÉNEMENTS CONNECTIVITY ---
  const handleConnectivityEvent = useCallback((event: ConnectivityEvent) => {
      switch (event.type) {
          case 'PEER_OPEN':
              setIsMigrating(false);
              setUser(prev => ({ ...prev, id: event.id }));
              break;
          case 'PEERS_UPDATED':
              setPeers(event.peers);
              break;
          case 'HOST_CONNECTED':
              setHostId(event.hostId);
              break;
          case 'TOAST':
              showToast(event.msg, event.level as any);
              break;
          case 'MIGRATION_START':
              setIsMigrating(true);
              break;
          case 'DISCONNECTED':
              if (event.reason === 'KICKED') {
                  Alert.alert("Exclu", "Vous avez été exclu par l'Hôte.");
                  finishLogout();
              } else if (event.reason === 'NO_HOST') {
                  showToast("Hôte perdu, déconnexion...", "error");
                  finishLogout();
              }
              break;
          case 'NEW_HOST_PROMOTED':
              setUser(prev => ({ ...prev, role: OperatorRole.HOST }));
              setHostId(event.hostId);
              break;
          case 'DATA_RECEIVED':
              handleProtocolData(event.data, event.from);
              break;
      }
  }, []);

  const handleProtocolData = (data: any, fromId: string) => {
      switch (data.type) {
        case 'PING':
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setPings(prev => [...prev, data.ping]);
            showToast(`PING: ${data.ping.msg}`);
            break;
        case 'PING_MOVE': 
            setPings(prev => prev.map(p => p.id === data.id ? { ...p, lat: data.lat, lng: data.lng } : p));
            break;
        case 'PING_DELETE': 
            setPings(prev => prev.filter(p => p.id !== data.id));
            break;
        case 'CLIENT_LEAVING':
            showToast(`${data.callsign} déconnecté`, 'info');
            if (privatePeerId === data.id) {
                leavePrivateMode();
            }
            break;
        case 'NAV_NOTIFY':
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setIncomingNavNotif(`${data.callsign} se dirige vers votre position.`);
            break;
      }
  };

  // --- NETWORK ROBUSTNESS ---
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const offline = !state.isConnected || !state.isInternetReachable;
      if (isOffline && !offline && view !== 'login' && hostId && !isMigrating) {
          showToast("Changement réseau détecté. Stabilisation...", "info");
          setTimeout(() => {
              console.log(`[Network] Restoring session for ${user.callsign}`);
              connectivityService.init(user, user.role, user.role === OperatorRole.HOST ? undefined : hostId, user.id);
          }, 2000);
      }
      setIsOffline(!!offline);
    });
    return unsubscribe;
  }, [isOffline, view, hostId, isMigrating, user]);

  // --- SENSORS & BATTERY ---
  useEffect(() => { 
      Battery.getBatteryLevelAsync().then(l => setUser(u => ({ ...u, bat: Math.floor(l * 100) }))); 
      const sub = Battery.addBatteryLevelListener(({ batteryLevel }) => setUser(u => ({ ...u, bat: Math.floor(batteryLevel * 100) }))); 
      return () => sub && sub.remove(); 
  }, []);
  
  useEffect(() => { 
      Magnetometer.setUpdateInterval(100); 
      const sub = Magnetometer.addListener((data) => { 
          let angle = Math.atan2(data.y, data.x) * (180 / Math.PI); 
          angle = angle - 90; 
          if (angle < 0) angle = 360 + angle; 
          
          setUser(prev => { 
              if (Math.abs(prev.head - angle) > 2) {
                  const newHead = Math.floor(angle);
                  const now = Date.now();
                  if (now - lastHeadBroadcast.current > 300 && hostId) {
                      connectivityService.updateUserPosition(prev.lat, prev.lng, newHead);
                      lastHeadBroadcast.current = now;
                  }
                  return { ...prev, head: newHead }; 
              }
              return prev; 
          }); 
      }); 
      return () => sub && sub.remove(); 
  }, [hostId]); 
  
  // --- BACK HANDLER ---
  useEffect(() => { const backAction = () => { 
      if (view === 'settings') { setView(lastView); return true; }
      if (selectedOperatorId) { setSelectedOperatorId(null); return true; } 
      if (showQRModal) { setShowQRModal(false); return true; } 
      if (showQuickMsgModal) { setShowQuickMsgModal(false); return true; }
      if (showScanner) { setShowScanner(false); return true; } 
      if (navTargetId) { setNavTargetId(null); showToast("Navigation arrêtée"); return true; }
      if (view === 'ops') { setView('menu'); return true; } 
      if (view === 'map') { setView('menu'); return true; }
      return false; 
  }; const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction); return () => backHandler.remove(); }, [view, selectedOperatorId, showQRModal, showScanner, lastView, navTargetId, showQuickMsgModal]);

  const showToast = useCallback((msg: string, type: 'info' | 'error' = 'info') => {
    setToast({ msg, type });
    if (type === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // --- ACTIONS ---

  const handleLogout = async () => {
      if (user.role === OperatorRole.HOST) {
          const candidates = Object.values(peers).filter(p => p.id !== user.id);
          if (candidates.length > 0) {
              connectivityService.broadcast({ type: 'HOST_LEAVING_MIGRATE', newHostId: user.id });
              candidates.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
              connectivityService.sendTo(candidates[0].id, { type: 'HOST_MIGRATE_INSTRUCTION', oldHostId: user.id });
              setTimeout(() => finishLogout(), 1500);
              return;
          }
      } 
      else {
          connectivityService.broadcast({ type: 'CLIENT_LEAVING', id: user.id, callsign: user.callsign });
          setTimeout(() => finishLogout(), 500);
          return;
      }
      finishLogout();
  };

  const finishLogout = () => {
      connectivityService.cleanup();
      if (gpsSubscription.current) { gpsSubscription.current.remove(); gpsSubscription.current = null; }
      setPeers({}); setPings([]); setHostId(''); setView('login'); 
      setIsServicesReady(false); setIsMigrating(false); setNavTargetId(null); setIncomingNavNotif(null);
      // Reset user state (sauf username/trigramme)
      setUser(prev => ({...prev, id: '', role: OperatorRole.OPR, status: OperatorStatus.CLEAR, lastMsg: '' }));
  };

  const copyToClipboard = async () => { 
      // Si Host : mon ID. Si Client : hostId.
      const idToShare = hostId || user.id;
      if (idToShare) { await Clipboard.setStringAsync(idToShare); showToast("ID Session Copié"); } 
  };

  const enterPrivateMode = (targetId: string) => {
      setPrivatePeerId(targetId);
      showToast("Focus sur la cible (Map)");
  };

  const leavePrivateMode = () => {
      setPrivatePeerId(null);
  };

  const handleKickUser = (targetId: string) => {
      connectivityService.sendTo(targetId, { type: 'KICK' });
      setPeers(prev => { const next = {...prev}; delete next[targetId]; return next; });
      setSelectedOperatorId(null);
      showToast("Utilisateur Banni");
  };

  const handleStartNavigation = (targetId: string) => {
      setSelectedOperatorId(null);
      setNavTargetId(targetId); 
      if (view !== 'map') setView('map');
      connectivityService.sendTo(targetId, { type: 'NAV_NOTIFY', callsign: user.callsign });
      showToast("Guidage Tactique Activé");
  };

  const sendQuickMessage = (msg: string) => {
      const finalMsg = msg === "RAS / Effacer" ? "" : msg;
      // UPDATE LOCAL
      setUser(prev => ({ ...prev, lastMsg: finalMsg }));
      // UPDATE NETWORK
      connectivityService.updateUser({ lastMsg: finalMsg });
      setShowQuickMsgModal(false);
      showToast(finalMsg ? "Message transmis" : "Message effacé");
  };

  const updateMyStatus = (s: OperatorStatus) => {
      // UPDATE LOCAL (Critical for pulse animation)
      setUser(prev => ({ ...prev, status: s }));
      // UPDATE NETWORK
      connectivityService.updateUserStatus(s);
  };

  const joinSession = async (id?: string) => {
    const finalId = id || hostInput.toUpperCase();
    if (!finalId) return;
    setHostId(finalId);
    if (!isServicesReady) await startServices();
    setUser(prev => ({ ...prev, role: OperatorRole.OPR }));
    connectivityService.init({ ...user, role: OperatorRole.OPR }, OperatorRole.OPR, finalId);
    setView('map');
  };

  const createSession = async () => {
      if (!isServicesReady) await startServices();
      setUser(prev => ({ ...prev, role: OperatorRole.HOST }));
      connectivityService.init({ ...user, role: OperatorRole.HOST }, OperatorRole.HOST);
      setView('map');
  };

  const handleScannerBarCodeScanned = ({ data }: any) => {
    setShowScanner(false);
    setHostInput(data);
    setTimeout(() => joinSession(data), 500);
  };

  const startGpsTracking = async (interval: number) => {
      if (gpsSubscription.current) gpsSubscription.current.remove();

      gpsSubscription.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: interval, distanceInterval: 5 },
        (loc) => {
            const { latitude, longitude, speed, heading, accuracy } = loc.coords;
            if (accuracy && accuracy > 100) return;

            setGpsStatus('OK');
            
            setUser(prev => {
                const gpsHead = (speed && speed > 1 && heading !== null) ? heading : prev.head;
                const newUser = { ...prev, lat: latitude, lng: longitude, head: gpsHead };
                
                if (!lastLocationRef.current || Math.abs(latitude - lastLocationRef.current.lat) > 0.0001 || Math.abs(longitude - lastLocationRef.current.lng) > 0.0001) {
                    connectivityService.updateUserPosition(latitude, longitude, gpsHead);
                    lastLocationRef.current = { lat: latitude, lng: longitude };
                }
                return newUser;
            });
        }
      );
  };

  const checkAllPermissions = async () => {
      if (Platform.OS === 'android') {
        try {
            const permsToRequest = [
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
            ];
            if (Platform.Version >= 33) permsToRequest.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
            
            await PermissionsAndroid.requestMultiple(permsToRequest);
        } catch (err) { console.warn("Permissions Error", err); }
      }
  };

  const startServices = async () => {
    if (!hasConsent || isServicesReady) return;
    try {
        await checkAllPermissions();
        
        const locationStatus = await Location.getForegroundPermissionsAsync();
        if (locationStatus.granted) {
            try {
                const initialLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
                if (initialLoc && initialLoc.coords) {
                    setUser(prev => ({ ...prev, lat: initialLoc.coords.latitude, lng: initialLoc.coords.longitude }));
                    setGpsStatus('OK');
                }
            } catch (e) {}
            startGpsTracking(settings.gpsUpdateInterval);
        } else {
             setGpsStatus('ERROR');
             showToast("GPS non disponible", "error");
        }
        
        if (permission && !permission.granted && permission.canAskAgain) {
            requestPermission();
        }
        
        setIsServicesReady(true);
    } catch (e) { showToast("Erreur critique services", "error"); }
  };

  useEffect(() => { if (hasConsent && user.callsign && view !== 'login') { startServices(); } }, [hasConsent, view]); 

  const handleLogin = async () => {
    const tri = loginInput.toUpperCase();
    if (tri.length < 2) return;
    try { await AsyncStorage.setItem(CONFIG.TRIGRAM_STORAGE_KEY, tri); } catch (e) {}
    if (tri !== settings.username) configService.update({ username: tri });
    setUser(prev => ({ ...prev, callsign: tri }));
    setView('menu');
  };

  const openSettings = () => { setLastView(view); setView('settings'); };

  // --- RENDERS ---
  const renderLogin = () => (
    <View style={styles.centerContainer}>
      <MaterialIcons name="fingerprint" size={80} color="#3b82f6" style={{opacity: 0.8, marginBottom: 30}} />
      <Text style={styles.title}>COM<Text style={{color: '#3b82f6'}}>TAC</Text> v3.0</Text>
      <TextInput 
        style={styles.input} placeholder="TRIGRAMME" placeholderTextColor="#52525b"
        maxLength={6} value={loginInput} onChangeText={setLoginInput} autoCapitalize="characters"
      />
      <TouchableOpacity onPress={handleLogin} style={styles.loginBtn}>
        <Text style={styles.loginBtnText}>CONNEXION</Text>
      </TouchableOpacity>
    </View>
  );

  const renderMenu = () => {
    const isSessionActive = !!hostId;
    return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.menuContainer}>
        <View style={{flexDirection: 'row', justifyContent:'space-between', alignItems:'center', marginBottom: 20}}>
            <Text style={styles.sectionTitle}>DÉPLOIEMENT</Text>
            <View style={{flexDirection: 'row', gap: 15}}>
                <TouchableOpacity onPress={openSettings} style={{padding: 5}}>
                    <MaterialIcons name="settings" size={24} color="#a1a1aa" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Alert.alert("Déconnexion", "Se déconnecter totalement ?", [{text:"Non"}, {text:"Oui", onPress:handleLogout}])} style={{padding: 5}}>
                    <MaterialIcons name="power-settings-new" size={24} color="#ef4444" />
                </TouchableOpacity>
            </View>
        </View>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 20, backgroundColor: '#18181b', padding: 10, borderRadius: 8}}>
                {isServicesReady ? (<MaterialIcons name="check-circle" size={16} color="#22c55e" />) : (<ActivityIndicator size="small" color="#3b82f6" />)}
                <Text style={{color: '#71717a', fontSize: 10, marginRight: 10}}>SYS</Text>
                {gpsStatus === 'WAITING' && <MaterialIcons name="gps-not-fixed" size={16} color="#eab308" />}
                {gpsStatus === 'OK' && <MaterialIcons name="gps-fixed" size={16} color="#22c55e" />}
                <Text style={{color: '#71717a', fontSize: 10}}>GPS</Text>
        </View>
        
        {isSessionActive ? (
            <View>
                <TouchableOpacity onPress={() => setView('map')} style={[styles.menuCard, {borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.1)'}]}>
                  <MaterialIcons name="map" size={40} color="#22c55e" />
                  <View style={{marginLeft: 20}}>
                    <Text style={[styles.menuCardTitle, {color: '#22c55e'}]}>CARTE TACTIQUE</Text>
                    <Text style={styles.menuCardSubtitle}>Réseau: {hostId}</Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.divider} />
                <TouchableOpacity onPress={() => Alert.alert("Fin de Mission", "Voulez-vous vraiment quitter le canal ?", [{text:"Non"}, {text:"Oui", onPress:handleLogout}])} style={[styles.menuCard, {borderColor: '#ef4444'}]}>
                  <MaterialIcons name="logout" size={40} color="#ef4444" />
                  <View style={{marginLeft: 20}}>
                    <Text style={[styles.menuCardTitle, {color: '#ef4444'}]}>QUITTER RÉSEAU</Text>
                  </View>
                </TouchableOpacity>
            </View>
        ) : (
            <>
                <TouchableOpacity onPress={createSession} style={styles.menuCard}>
                  <MaterialIcons name="add-location-alt" size={40} color="#3b82f6" />
                  <View style={{marginLeft: 20}}>
                    <Text style={styles.menuCardTitle}>Ouvrir Carte</Text>
                    <Text style={styles.menuCardSubtitle}>Hôte (Chef de groupe)</Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.divider} />
                <View style={styles.joinHeader}>
                    <Text style={styles.sectionTitle}>REJOINDRE</Text>
                    <TouchableOpacity onPress={() => setShowScanner(true)} style={styles.scanBtn}>
                        <MaterialIcons name="qr-code-scanner" size={16} color="#3b82f6" /><Text style={styles.scanBtnText}>SCANNER</Text>
                    </TouchableOpacity>
                </View>
                <TextInput style={styles.inputBox} placeholder="ID GROUPE..." placeholderTextColor="#52525b" value={hostInput} onChangeText={setHostInput} autoCapitalize="characters" />
                <TouchableOpacity onPress={() => joinSession()} style={styles.joinBtn}>
                    <Text style={styles.joinBtnText}>REJOINDRE</Text>
                </TouchableOpacity>
            </>
        )}
      </View>
    </SafeAreaView>
  )};

  const renderDashboard = () => (
    <View style={{flex: 1}}>
      <View style={{backgroundColor: '#09090b'}}>
          <SafeAreaView style={styles.header}>
            <View style={styles.headerContent}>
              <TouchableOpacity onPress={() => setView('menu')} style={{padding: 8, marginRight: 10}}>
                  <MaterialIcons name="arrow-back" size={24} color="#a1a1aa" />
              </TouchableOpacity>
              <View style={{flexDirection: 'row', alignItems: 'center', flex: 1}}>
                <MaterialIcons name="satellite" size={20} color="#3b82f6" />
                <Text style={styles.headerTitle}> COM<Text style={{color: '#3b82f6'}}>TAC</Text></Text>
              </View>
              <TouchableOpacity onPress={openSettings} style={{padding: 8, marginRight: 5}}>
                  <MaterialIcons name="settings" size={24} color="#a1a1aa" />
              </TouchableOpacity>
              
              <TouchableOpacity onPress={() => setView(view === 'map' ? 'ops' : 'map')} style={[styles.navBtn, view === 'map' ? styles.navBtnActive : null]}>
                <MaterialIcons name={view === 'map' ? 'list' : 'map'} size={16} color={view === 'map' ? 'white' : '#a1a1aa'} />
                <Text style={[styles.navBtnText, view === 'map' ? {color:'white'} : null]}>{view === 'map' ? 'LISTE' : 'CARTE'}</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
          {isOffline && (<View style={[styles.silenceBanner, {backgroundColor: '#ef4444'}]}><Text style={styles.silenceText}>CONNEXION PERDUE</Text></View>)}
          {isMigrating && (<View style={[styles.silenceBanner, {backgroundColor: '#eab308'}]}><Text style={styles.silenceText}>MIGRATION HÔTE...</Text></View>)}
      </View>

      <View style={styles.mainContent}>
        {view === 'ops' ? (
          <ScrollView contentContainerStyle={styles.grid}>
             {/* Moi-même */}
             <OperatorCard user={user} isMe style={{ width: '100%' }} />
             
             {/* Les autres */}
             {Object.values(peers).filter(p => p.id !== user.id).map(p => (
                 <TouchableOpacity 
                    key={p.id} 
                    onLongPress={() => setSelectedOperatorId(p.id)} 
                    activeOpacity={0.8}
                    style={{ width: '100%', marginBottom: 10 }}
                 >
                    <OperatorCard user={p} me={user} style={{ width: '100%' }} />
                 </TouchableOpacity>
             ))}
          </ScrollView>
        ) : (
          <View style={{flex: 1}}>
             {gpsStatus === 'OK' && user.lat !== 0 ? (
                <TacticalMap 
                  me={user} peers={peers} pings={pings} 
                  mapMode={mapMode} showTrails={showTrails} pingMode={isPingMode}
                  showPings={showPings} isHost={user.role === OperatorRole.HOST}
                  userArrowColor={settings.userArrowColor} 
                  navTargetId={navTargetId} 
                  onPing={(loc) => { setTempPingLoc(loc); setShowPingModal(true); }}
                  onPingMove={(p) => { setPings(prev => prev.map(pi => pi.id === p.id ? p : pi)); connectivityService.broadcast({ type: 'PING_MOVE', id: p.id, lat: p.lat, lng: p.lng }); }}
                  onPingDelete={(id) => { setPings(prev => prev.filter(p => p.id !== id)); connectivityService.broadcast({ type: 'PING_DELETE', id: id }); }}
                  onNavStop={() => { setNavTargetId(null); showToast("Navigation arrêtée"); }} 
                />
             ) : (
                <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000'}}>
                    <ActivityIndicator size="large" color="#3b82f6" />
                    <Text style={{color: 'white', marginTop: 20}}>Acquisition signal GPS...</Text>
                    <Text style={{color: '#71717a', fontSize: 12, marginTop: 5}}>En attente de précision...</Text>
                </View>
             )}
            <View style={styles.mapControls}>
                <TouchableOpacity onPress={() => setMapMode(m => m === 'dark' ? 'light' : m === 'light' ? 'satellite' : 'dark')} style={styles.mapBtn}>
                    <MaterialIcons name={mapMode === 'dark' ? 'dark-mode' : mapMode === 'light' ? 'light-mode' : 'satellite'} size={24} color="#d4d4d8" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowTrails(!showTrails)} style={styles.mapBtn}>
                    <MaterialIcons name={showTrails ? 'visibility' : 'visibility-off'} size={24} color="#d4d4d8" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowPings(!showPings)} style={styles.mapBtn}>
                    <MaterialIcons name={showPings ? 'location-on' : 'location-off'} size={24} color="#d4d4d8" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setIsPingMode(!isPingMode)} style={[styles.mapBtn, isPingMode ? {backgroundColor: '#dc2626', borderColor: '#f87171'} : null]}>
                    <MaterialIcons name="ads-click" size={24} color="white" />
                </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.statusRow}>
            {[OperatorStatus.PROGRESSION, OperatorStatus.CONTACT, OperatorStatus.CLEAR].map(s => (
                <TouchableOpacity 
                    key={s} 
                    onPress={() => updateMyStatus(s)}
                    style={[styles.statusBtn, user.status === s ? { backgroundColor: STATUS_COLORS[s], borderColor: 'white' } : null]}
                >
                    <Text style={[styles.statusBtnText, user.status === s ? {color:'white'} : null]}>{s}</Text>
                </TouchableOpacity>
            ))}
            
            <TouchableOpacity onPress={() => setShowQuickMsgModal(true)} style={[styles.statusBtn, {borderColor: '#06b6d4'}]}>
                <Text style={[styles.statusBtnText, {color: '#06b6d4'}]}>MSG</Text>
            </TouchableOpacity>
            
            <TouchableOpacity onPress={() => setShowQRModal(true)} style={[styles.statusBtn, {borderColor: '#d4d4d8'}]}>
                <MaterialIcons name="qr-code-2" size={16} color="#d4d4d8" />
            </TouchableOpacity>
        </View>
      </View>

      {/* --- MODALES --- */}

      <Modal visible={showQRModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>SESSION TACTIQUE</Text>
            {/* Affiche l'ID de l'Hôte (pour que d'autres rejoignent le MEME réseau) ou Mon ID si je suis Hôte */}
            <QRCode value={hostId || user.id || 'NO_ID'} size={200} />
            <TouchableOpacity onPress={copyToClipboard}>
                <Text style={styles.qrId}>{hostId || user.id}</Text>
            </TouchableOpacity>
            <Text style={{color: '#71717a', fontSize: 10, marginTop: 10}}>Faites scanner ce code pour rejoindre le réseau</Text>
            <TouchableOpacity onPress={() => setShowQRModal(false)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>FERMER</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showScanner} animationType="slide">
        <View style={{flex: 1, backgroundColor: 'black'}}>
          {permission?.granted ? (
              <CameraView 
                style={{flex: 1}} 
                onBarcodeScanned={handleScannerBarCodeScanned} 
                barcodeScannerSettings={{barcodeTypes: ["qr"]}} 
              />
          ) : (
              <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
                  <Text style={{color: 'white', textAlign: 'center'}}>Permission caméra requise</Text>
                  <TouchableOpacity onPress={requestPermission} style={[styles.modalBtn, {backgroundColor: '#3b82f6', marginTop: 20}]}>
                      <Text style={{color: 'white'}}>Autoriser</Text>
                  </TouchableOpacity>
              </View>
          )}
          
          <TouchableOpacity onPress={() => setShowScanner(false)} style={styles.scannerClose}>
            <MaterialIcons name="close" size={30} color="white" />
          </TouchableOpacity>
          <View style={{position: 'absolute', bottom: 50, alignSelf: 'center'}}>
              <Text style={{color: 'white', backgroundColor: 'rgba(0,0,0,0.5)', padding: 10}}>Scannez le QR Code de l'Hôte</Text>
          </View>
        </View>
      </Modal>

      <Modal visible={showPingModal} animationType="fade" transparent>
         <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, {backgroundColor: '#18181b', borderWidth: 1, borderColor: '#333'}]}>
               <Text style={[styles.modalTitle, {color: 'white'}]}>ENVOYER PING</Text>
               <TextInput style={styles.pingInput} placeholder="Message (ex: ENNEMI)" placeholderTextColor="#71717a" onChangeText={setPingMsgInput} autoFocus />
               <View style={{flexDirection: 'row', gap: 10}}>
                   <TouchableOpacity onPress={() => setShowPingModal(false)} style={[styles.modalBtn, {backgroundColor: '#27272a'}]}>
                       <Text style={{color: 'white', fontWeight: 'bold'}}>ANNULER</Text>
                   </TouchableOpacity>
                   <TouchableOpacity onPress={() => { if(tempPingLoc && pingMsgInput) { const newPing: PingData = { id: Math.random().toString(36).substr(2, 9), lat: tempPingLoc.lat, lng: tempPingLoc.lng, msg: pingMsgInput, sender: user.callsign, timestamp: Date.now() }; setPings(prev => [...prev, newPing]); connectivityService.broadcast({ type: 'PING', ping: newPing }); setShowPingModal(false); setPingMsgInput(''); setIsPingMode(false); } }} style={[styles.modalBtn, {backgroundColor: '#ef4444'}]}>
                       <Text style={{color: 'white', fontWeight: 'bold'}}>ENVOYER</Text>
                   </TouchableOpacity>
               </View>
            </View>
         </View>
      </Modal>

      <Modal visible={showQuickMsgModal} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, {backgroundColor: '#18181b', borderWidth: 1, borderColor: '#333', maxHeight: '80%'}]}>
                  <Text style={[styles.modalTitle, {color: '#06b6d4', marginBottom: 15}]}>MESSAGE RAPIDE</Text>
                  <FlatList 
                      data={quickMessagesList} 
                      keyExtractor={(item, index) => index.toString()}
                      renderItem={({item}) => (
                          <TouchableOpacity onPress={() => sendQuickMessage(item)} style={styles.quickMsgItem}>
                              <Text style={styles.quickMsgText}>{item}</Text>
                          </TouchableOpacity>
                      )}
                      ItemSeparatorComponent={() => <View style={{height: 1, backgroundColor: '#27272a'}} />}
                  />
                  <TouchableOpacity onPress={() => setShowQuickMsgModal(false)} style={[styles.closeBtn, {backgroundColor: '#27272a', marginTop: 15}]}>
                      <Text style={{color: '#a1a1aa'}}>ANNULER</Text>
                  </TouchableOpacity>
              </View>
          </View>
      </Modal>

      {incomingNavNotif && (
          <NavNotification 
            message={incomingNavNotif} 
            onDismiss={() => setIncomingNavNotif(null)} 
          />
      )}

      {toast && (
        <View style={[styles.toast, toast.type === 'error' && {backgroundColor: '#ef4444'}]}>
           <Text style={styles.toastText}>{toast.msg}</Text>
        </View>
      )}
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
  joinHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  scanBtnText: { color: '#3b82f6', fontWeight: 'bold', fontSize: 12 },
  inputBox: { backgroundColor: '#18181b', borderRadius: 16, padding: 20, fontSize: 20, color: 'white', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', marginBottom: 15 },
  joinBtn: { backgroundColor: '#27272a', padding: 20, borderRadius: 16, alignItems: 'center' },
  joinBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },
  header: { backgroundColor: '#09090b', borderBottomWidth: 1, borderBottomColor: '#27272a', paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0 },
  headerContent: { height: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20 },
  headerTitle: { color: 'white', fontWeight: '900', fontSize: 18 },
  navBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: '#27272a', gap: 5, backgroundColor: '#18181b' },
  navBtnActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  navBtnText: { color: '#a1a1aa', fontSize: 10, fontWeight: 'bold' },
  silenceBanner: { backgroundColor: '#ef4444', padding: 8, alignItems: 'center', width: '100%' },
  silenceText: { color: 'white', fontWeight: 'bold', fontSize: 12, letterSpacing: 1 },
  mainContent: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 16, gap: 12 },
  footer: { backgroundColor: '#050505', borderTopWidth: 1, borderTopColor: '#27272a', paddingBottom: 20 },
  statusRow: { flexDirection: 'row', padding: 12, gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  statusBtn: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 8, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a' },
  statusBtnText: { color: '#71717a', fontSize: 12, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center', padding: 30 },
  modalContent: { width: '100%', backgroundColor: 'white', padding: 24, borderRadius: 24, alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '900', marginBottom: 20 },
  qrId: { marginTop: 20, fontSize: 10, backgroundColor: '#f4f4f5', padding: 8, borderRadius: 4 },
  closeBtn: { marginTop: 20, backgroundColor: '#2563eb', width: '100%', padding: 16, borderRadius: 12, alignItems: 'center' },
  closeBtnText: { color: 'white', fontWeight: 'bold' },
  scannerClose: { position: 'absolute', top: 50, right: 20, padding: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 },
  mapControls: { position: 'absolute', top: 16, right: 16, gap: 12 },
  mapBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#18181b', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  pingInput: { width: '100%', backgroundColor: 'black', color: 'white', padding: 16, borderRadius: 12, textAlign: 'center', fontSize: 18, marginBottom: 20 },
  modalBtn: { flex: 1, padding: 16, borderRadius: 12, alignItems: 'center' },
  toast: { position: 'absolute', top: 50, alignSelf: 'center', backgroundColor: '#1e3a8a', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, zIndex: 9999 },
  toastText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  navNotif: {
      position: 'absolute', top: 100, left: 20, right: 20,
      backgroundColor: '#18181b', borderRadius: 12,
      borderWidth: 1, borderColor: '#06b6d4',
      padding: 15, flexDirection: 'row', alignItems: 'center', gap: 15,
      zIndex: 10000, shadowColor: "#000", shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.5, shadowRadius: 10, elevation: 5
  },
  navNotifText: { color: 'white', fontWeight: 'bold', flex: 1, fontSize: 14 },
  quickMsgItem: { paddingVertical: 15, paddingHorizontal: 10, width: '100%', alignItems: 'center' },
  quickMsgText: { color: 'white', fontSize: 16, fontWeight: 'bold' }
});

export default App;
