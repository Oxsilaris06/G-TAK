import './polyfills'; 
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  SafeAreaView, Platform, Modal, StatusBar as RNStatusBar, Alert, BackHandler, ScrollView, ActivityIndicator,
  PermissionsAndroid, Animated, PanResponder, FlatList, KeyboardAvoidingView
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import QRCode from 'react-native-qrcode-svg';

// FIX: Camera API check
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

import { UserData, OperatorStatus, OperatorRole, ViewType, PingData, AppSettings, DEFAULT_SETTINGS, PingType, HostileDetails } from './types';
import { CONFIG, STATUS_COLORS } from './constants';
import { configService } from './services/configService';
import { connectivityService, ConnectivityEvent } from './services/connectivityService'; 

import OperatorCard from './components/OperatorCard';
import TacticalMap from './components/TacticalMap';
import SettingsView from './components/SettingsView';

// Import statique du fichier msg.json par défaut
const DEFAULT_MSG_JSON = require('./msg.json');

// --- COMPOSANT NOTIFICATION ---
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
      <Animated.View style={[styles.navNotif, { transform: [{ translateX: pan.x }] }]} {...panResponder.panHandlers}>
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

  // --- STATES ---
  const [isAppReady, setIsAppReady] = useState(false); // NOUVEAU: Guard anti-écran blanc

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [user, setUser] = useState<UserData>({
    id: '', callsign: '', role: OperatorRole.OPR,
    status: OperatorStatus.CLEAR,
    joinedAt: Date.now(), bat: 100, head: 0, lat: 0, lng: 0 
  });

  const [view, setView] = useState<ViewType>('login');
  const [lastView, setLastView] = useState<ViewType>('menu'); 
  const [peers, setPeers] = useState<Record<string, UserData>>({});
  const [pings, setPings] = useState<PingData[]>([]);
  const [hostId, setHostId] = useState<string>('');
  
  // Inputs
  const [loginInput, setLoginInput] = useState('');
  const [hostInput, setHostInput] = useState('');
  
  // Map State
  const [mapMode, setMapMode] = useState<'dark' | 'light' | 'satellite'>('satellite');
  const [showTrails, setShowTrails] = useState(true);
  const [showPings, setShowPings] = useState(true);
  
  // Modals & UI
  const [showQRModal, setShowQRModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showQuickMsgModal, setShowQuickMsgModal] = useState(false);
  const [quickMessagesList, setQuickMessagesList] = useState<string[]>([]);
  
  // Ping Creation Logic
  const [showPingMenu, setShowPingMenu] = useState(false); // Menu Type (Ami/Ennemi/Rens)
  const [showPingForm, setShowPingForm] = useState(false); // Formulaire détails
  const [tempPingLoc, setTempPingLoc] = useState<any>(null);
  const [currentPingType, setCurrentPingType] = useState<PingType>('FRIEND');
  const [pingMsgInput, setPingMsgInput] = useState('');
  // Details Caneva Hostile
  const [hostileDetails, setHostileDetails] = useState<HostileDetails>({});
  
  // Ping Edit Logic
  const [editingPing, setEditingPing] = useState<PingData | null>(null);

  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null);
  const [navTargetId, setNavTargetId] = useState<string | null>(null);
  const [incomingNavNotif, setIncomingNavNotif] = useState<string | null>(null);

  const [hasConsent, setHasConsent] = useState(true);
  const [isServicesReady, setIsServicesReady] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'WAITING' | 'OK' | 'ERROR'>('WAITING');
  
  const lastLocationRef = useRef<any>(null);
  const lastHeadBroadcast = useRef<number>(0);
  const gpsSubscription = useRef<Location.LocationSubscription | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null);

  // --- INITIALISATION SÉCURISÉE ---
  useEffect(() => {
      const initApp = async () => {
          try {
              // 1. Charger Config
              const s = await configService.init();
              
              // 2. Charger msg.json par défaut si liste vide
              let msgs = s.quickMessages;
              if (!msgs || msgs.length === 0) {
                  // Fallback sur le JSON importé si disponible
                  if (Array.isArray(DEFAULT_MSG_JSON)) {
                      msgs = DEFAULT_MSG_JSON;
                      configService.update({ quickMessages: msgs }); // Sauvegarder pour plus tard
                  } else {
                      msgs = DEFAULT_SETTINGS.quickMessages;
                  }
              }
              
              setSettings(s);
              setQuickMessagesList(msgs);
              
              if (s.username) {
                setUser(prev => ({ ...prev, callsign: s.username }));
                setLoginInput(s.username);
              }
          } catch (e) {
              console.warn("Init Error", e);
          } finally {
              setIsAppReady(true); // Débloque le rendu
          }
      };

      initApp();

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

      return () => { unsubConfig(); unsubConn(); };
  }, []); 

  // --- HANDLERS ---
  const handleConnectivityEvent = useCallback((event: ConnectivityEvent) => {
      switch (event.type) {
          case 'PEER_OPEN':
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
          case 'DATA_RECEIVED':
              handleProtocolData(event.data, event.from);
              break;
          case 'DISCONNECTED':
              if (event.reason === 'KICKED') { Alert.alert("Exclu", "Banni par l'hôte."); finishLogout(); }
              else if (event.reason === 'NO_HOST') { showToast("Hôte perdu", "error"); finishLogout(); }
              break;
      }
  }, []);

  const handleProtocolData = (data: any, fromId: string) => {
      switch (data.type) {
        case 'PING':
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setPings(prev => [...prev, data.ping]);
            showToast(`ALERTE: ${data.ping.type} - ${data.ping.msg}`);
            break;
        case 'PING_MOVE': 
            setPings(prev => prev.map(p => p.id === data.id ? { ...p, lat: data.lat, lng: data.lng } : p));
            break;
        case 'PING_UPDATE': // Nouveau: Edit Texte
            setPings(prev => prev.map(p => p.id === data.id ? { ...p, msg: data.msg, details: data.details } : p));
            break;
        case 'PING_DELETE': 
            setPings(prev => prev.filter(p => p.id !== data.id));
            break;
        case 'NAV_NOTIFY':
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setIncomingNavNotif(`${data.callsign} en route vers vous.`);
            break;
      }
  };

  // --- SENSORS ---
  useEffect(() => { 
      Battery.getBatteryLevelAsync().then(l => setUser(u => ({ ...u, bat: Math.floor(l * 100) }))); 
      const sub = Battery.addBatteryLevelListener(({ batteryLevel }) => setUser(u => ({ ...u, bat: Math.floor(batteryLevel * 100) }))); 
      return () => sub && sub.remove(); 
  }, []);
  
  useEffect(() => { 
      Magnetometer.setUpdateInterval(100); 
      const sub = Magnetometer.addListener((data) => { 
          let angle = Math.atan2(data.y, data.x) * (180 / Math.PI) - 90; 
          if (angle < 0) angle += 360; 
          setUser(prev => { 
              if (Math.abs(prev.head - angle) > 3) {
                  const now = Date.now();
                  if (now - lastHeadBroadcast.current > 500 && hostId) {
                      connectivityService.updateUserPosition(prev.lat, prev.lng, Math.floor(angle));
                      lastHeadBroadcast.current = now;
                  }
                  return { ...prev, head: Math.floor(angle) }; 
              }
              return prev; 
          }); 
      }); 
      return () => sub && sub.remove(); 
  }, [hostId]);

  // --- PING LOGIC ---
  const startPingCreation = (loc: { lat: number, lng: number }) => {
      setTempPingLoc(loc);
      setShowPingMenu(true); // Ouvre le choix du type
  };

  const selectPingType = (type: PingType) => {
      setCurrentPingType(type);
      setShowPingMenu(false);
      setPingMsgInput('');
      setHostileDetails({});
      setShowPingForm(true); // Ouvre le formulaire de détails
  };

  const submitPing = () => {
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
      connectivityService.broadcast({ type: 'PING', ping: newPing });
      
      setShowPingForm(false);
      setTempPingLoc(null);
  };

  const handlePingClick = (id: string) => {
      const p = pings.find(ping => ping.id === id);
      if (!p) return;
      
      // Seul l'auteur ou l'hôte peut éditer
      if (user.role === OperatorRole.HOST || p.sender === user.callsign) {
          setEditingPing(p);
          setPingMsgInput(p.msg);
          if (p.details) setHostileDetails(p.details);
      } else {
          showToast(`Ping de ${p.sender}`, 'info');
      }
  };

  const savePingEdit = () => {
      if (!editingPing) return;
      
      const updatedPing = { ...editingPing, msg: pingMsgInput, details: editingPing.type === 'HOSTILE' ? hostileDetails : undefined };
      
      // Update Local
      setPings(prev => prev.map(p => p.id === editingPing.id ? updatedPing : p));
      
      // Broadcast Update
      connectivityService.broadcast({ 
          type: 'PING_UPDATE', 
          id: editingPing.id, 
          msg: pingMsgInput, 
          details: updatedPing.details 
      });

      setEditingPing(null);
  };

  const deletePing = () => {
      if (!editingPing) return;
      setPings(prev => prev.filter(p => p.id !== editingPing.id));
      connectivityService.broadcast({ type: 'PING_DELETE', id: editingPing.id });
      setEditingPing(null);
  };

  // --- ACTIONS ---
  const finishLogout = () => {
      connectivityService.cleanup();
      if (gpsSubscription.current) { gpsSubscription.current.remove(); gpsSubscription.current = null; }
      setPeers({}); setPings([]); setHostId(''); setView('login'); 
      setIsServicesReady(false); setNavTargetId(null);
      setUser(prev => ({...prev, id: '', role: OperatorRole.OPR, status: OperatorStatus.CLEAR, lastMsg: '' }));
  };

  const handleLogout = () => {
      Alert.alert("Déconnexion", "Quitter le réseau ?", [
          { text: "Non" },
          { text: "Oui", onPress: () => {
             if (user.role === OperatorRole.HOST) connectivityService.broadcast({ type: 'CLIENT_LEAVING', id: user.id }); // Simple leave for now
             else connectivityService.broadcast({ type: 'CLIENT_LEAVING', id: user.id, callsign: user.callsign });
             finishLogout();
          }}
      ]);
  };

  const startServices = async () => {
    if (isServicesReady) return;
    try {
        if (Platform.OS === 'android') {
             await PermissionsAndroid.requestMultiple([
                 PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                 PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION
             ]);
        }
        
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
            startGpsTracking(settings.gpsUpdateInterval);
        } else {
             setGpsStatus('ERROR');
        }
        setIsServicesReady(true);
    } catch (e) { console.warn(e); }
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
                if (!lastLocationRef.current || Math.abs(latitude - lastLocationRef.current.lat) > 0.0001 || Math.abs(longitude - lastLocationRef.current.lng) > 0.0001) {
                    connectivityService.updateUserPosition(latitude, longitude, gpsHead);
                    lastLocationRef.current = { lat: latitude, lng: longitude };
                }
                return { ...prev, lat: latitude, lng: longitude, head: gpsHead };
            });
        }
      );
  };

  const joinSession = async (id?: string) => {
      const finalId = id || hostInput.toUpperCase();
      if (!finalId) return;
      setHostId(finalId);
      await startServices();
      setUser(prev => ({ ...prev, role: OperatorRole.OPR }));
      connectivityService.init({ ...user, role: OperatorRole.OPR }, OperatorRole.OPR, finalId);
      setView('map');
  };

  const createSession = async () => {
      await startServices();
      setUser(prev => ({ ...prev, role: OperatorRole.HOST }));
      connectivityService.init({ ...user, role: OperatorRole.HOST }, OperatorRole.HOST);
      setView('map');
  };

  // --- RENDERERS ---
  
  // Guard Écran Blanc
  if (!isAppReady) {
      return (
          <View style={[styles.container, styles.centerContainer]}>
              <ActivityIndicator size="large" color="#3b82f6" />
              <Text style={{color: 'white', marginTop: 20}}>Initialisation...</Text>
          </View>
      );
  }

  const renderLogin = () => (
    <View style={styles.centerContainer}>
      <MaterialIcons name="fingerprint" size={80} color="#3b82f6" style={{opacity: 0.8, marginBottom: 30}} />
      <Text style={styles.title}>COM<Text style={{color: '#3b82f6'}}>TAC</Text></Text>
      <TextInput 
        style={styles.input} placeholder="TRIGRAMME" placeholderTextColor="#52525b"
        maxLength={6} value={loginInput} onChangeText={setLoginInput} autoCapitalize="characters"
      />
      <TouchableOpacity onPress={async () => {
          if (loginInput.length < 2) return;
          try { await AsyncStorage.setItem(CONFIG.TRIGRAM_STORAGE_KEY, loginInput.toUpperCase()); } catch (e) {}
          if (loginInput.toUpperCase() !== settings.username) configService.update({ username: loginInput.toUpperCase() });
          setUser(prev => ({ ...prev, callsign: loginInput.toUpperCase() }));
          setView('menu');
      }} style={styles.loginBtn}>
        <Text style={styles.loginBtnText}>CONNEXION</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor="#050505" />
      
      {view === 'settings' ? (
         <SettingsView onClose={() => setView(lastView)} />
      ) : view === 'login' ? renderLogin() : (
        <View style={{flex: 1}}>
             {view === 'menu' && (
                 <SafeAreaView style={styles.safeArea}>
                    <View style={styles.menuContainer}>
                        {/* Menu content simplified for brevity, logic remains same */}
                        <Text style={styles.sectionTitle}>DÉPLOIEMENT</Text>
                        <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:20}}>
                             <TouchableOpacity onPress={() => setView('settings')}><MaterialIcons name="settings" size={24} color="#a1a1aa" /></TouchableOpacity>
                             <TouchableOpacity onPress={handleLogout}><MaterialIcons name="power-settings-new" size={24} color="#ef4444" /></TouchableOpacity>
                        </View>

                        {!hostId ? (
                            <>
                                <TouchableOpacity onPress={createSession} style={styles.menuCard}>
                                    <MaterialIcons name="add-location-alt" size={40} color="#3b82f6" />
                                    <Text style={[styles.menuCardTitle, {marginLeft:20}]}>Ouvrir Carte</Text>
                                </TouchableOpacity>
                                <View style={styles.divider} />
                                <Text style={styles.sectionTitle}>REJOINDRE</Text>
                                <TextInput style={styles.inputBox} placeholder="ID GROUPE..." placeholderTextColor="#52525b" value={hostInput} onChangeText={setHostInput} autoCapitalize="characters" />
                                <TouchableOpacity onPress={() => joinSession()} style={styles.joinBtn}><Text style={styles.joinBtnText}>REJOINDRE</Text></TouchableOpacity>
                                <TouchableOpacity onPress={() => setShowScanner(true)} style={[styles.joinBtn, {marginTop: 10, backgroundColor: '#18181b', borderWidth:1, borderColor:'#333'}]}><Text style={styles.joinBtnText}>SCANNER QR</Text></TouchableOpacity>
                            </>
                        ) : (
                            <TouchableOpacity onPress={() => setView('map')} style={[styles.menuCard, {borderColor: '#22c55e'}]}>
                                <MaterialIcons name="map" size={40} color="#22c55e" />
                                <Text style={[styles.menuCardTitle, {marginLeft:20, color: '#22c55e'}]}>RETOUR CARTE</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                 </SafeAreaView>
             )}

             {(view === 'ops' || view === 'map') && (
                 <View style={{flex: 1}}>
                     {/* HEADER SIMPLIFIÉ */}
                     <SafeAreaView style={{backgroundColor: '#09090b', borderBottomWidth: 1, borderColor: '#27272a', flexDirection:'row', alignItems:'center', justifyContent:'space-between', padding: 10, paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0}}>
                        <TouchableOpacity onPress={() => setView('menu')}><MaterialIcons name="arrow-back" size={24} color="#a1a1aa" /></TouchableOpacity>
                        <Text style={styles.headerTitle}>COM<Text style={{color: '#3b82f6'}}>TAC</Text></Text>
                        <TouchableOpacity onPress={() => setView(view === 'map' ? 'ops' : 'map')}><MaterialIcons name={view === 'map' ? 'list' : 'map'} size={24} color="white" /></TouchableOpacity>
                     </SafeAreaView>

                     {view === 'ops' ? (
                         <ScrollView contentContainerStyle={styles.grid}>
                             <OperatorCard user={user} isMe style={{width:'100%'}} />
                             {Object.values(peers).filter(p => p.id !== user.id).map(p => (
                                 <TouchableOpacity key={p.id} onLongPress={() => setSelectedOperatorId(p.id)} style={{width:'100%', marginBottom:10}}>
                                     <OperatorCard user={p} me={user} style={{width:'100%'}} />
                                 </TouchableOpacity>
                             ))}
                         </ScrollView>
                     ) : (
                         <View style={{flex: 1}}>
                             <TacticalMap 
                                me={user} peers={peers} pings={pings} 
                                mapMode={mapMode} showTrails={showTrails} showPings={showPings} 
                                isHost={user.role === OperatorRole.HOST}
                                userArrowColor={settings.userArrowColor} 
                                navTargetId={navTargetId} 
                                // Callbacks
                                onPing={startPingCreation}
                                onPingMove={(p) => { 
                                    setPings(prev => prev.map(pi => pi.id === p.id ? p : pi)); 
                                    connectivityService.broadcast({ type: 'PING_MOVE', id: p.id, lat: p.lat, lng: p.lng }); 
                                }}
                                onPingClick={handlePingClick} // Nouveau Handler
                                onNavStop={() => setNavTargetId(null)} 
                             />
                             {/* Map Controls */}
                             <View style={styles.mapControls}>
                                <TouchableOpacity onPress={() => setMapMode(m => m === 'dark' ? 'light' : m === 'light' ? 'satellite' : 'dark')} style={styles.mapBtn}><MaterialIcons name="layers" size={24} color="#d4d4d8" /></TouchableOpacity>
                                <TouchableOpacity onPress={() => setShowPings(!showPings)} style={styles.mapBtn}><MaterialIcons name={showPings ? 'location-on' : 'location-off'} size={24} color="#d4d4d8" /></TouchableOpacity>
                                <TouchableOpacity onPress={() => setShowTrails(!showTrails)} style={styles.mapBtn}><MaterialIcons name={showTrails ? 'visibility' : 'visibility-off'} size={24} color="#d4d4d8" /></TouchableOpacity>
                             </View>
                         </View>
                     )}

                     {/* FOOTER BAR */}
                     <View style={styles.footer}>
                        <View style={styles.statusRow}>
                            {[OperatorStatus.PROGRESSION, OperatorStatus.CONTACT, OperatorStatus.CLEAR].map(s => (
                                <TouchableOpacity key={s} onPress={() => { setUser(prev => ({...prev, status:s})); connectivityService.updateUserStatus(s); }} style={[styles.statusBtn, user.status === s && {backgroundColor:STATUS_COLORS[s], borderColor:'white'}]}>
                                    <Text style={[styles.statusBtnText, user.status===s && {color:'white'}]}>{s}</Text>
                                </TouchableOpacity>
                            ))}
                            <TouchableOpacity onPress={() => setShowQuickMsgModal(true)} style={[styles.statusBtn, {borderColor: '#06b6d4'}]}><Text style={[styles.statusBtnText, {color: '#06b6d4'}]}>MSG</Text></TouchableOpacity>
                        </View>
                     </View>
                 </View>
             )}
        </View>
      )}

      {/* --- MODAL PING TYPE SELECTOR --- */}
      <Modal visible={showPingMenu} transparent animationType="fade">
          <View style={styles.modalOverlay}>
              <View style={styles.pingMenuContainer}>
                  <Text style={styles.modalTitle}>TYPE DE MARQUEUR</Text>
                  <View style={{flexDirection: 'row', gap: 15, justifyContent: 'center'}}>
                      <TouchableOpacity onPress={() => selectPingType('HOSTILE')} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444'}]}>
                          <MaterialIcons name="warning" size={40} color="#ef4444" />
                          <Text style={{color: '#ef4444', fontWeight: 'bold', marginTop: 5}}>ADVERSAIRE</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => selectPingType('FRIEND')} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(34, 197, 94, 0.2)', borderColor: '#22c55e'}]}>
                          <MaterialIcons name="shield" size={40} color="#22c55e" />
                          <Text style={{color: '#22c55e', fontWeight: 'bold', marginTop: 5}}>AMI</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => selectPingType('INTEL')} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(234, 179, 8, 0.2)', borderColor: '#eab308'}]}>
                          <MaterialIcons name="visibility" size={40} color="#eab308" />
                          <Text style={{color: '#eab308', fontWeight: 'bold', marginTop: 5}}>RENS</Text>
                      </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => setShowPingMenu(false)} style={[styles.closeBtn, {marginTop: 20, backgroundColor: '#27272a'}]}><Text style={{color:'white'}}>ANNULER</Text></TouchableOpacity>
              </View>
          </View>
      </Modal>

      {/* --- MODAL PING FORM (CREATION) --- */}
      <Modal visible={showPingForm} transparent animationType="slide">
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
              <View style={[styles.modalContent, {width: '90%', maxHeight: '80%'}]}>
                  <Text style={[styles.modalTitle, {color: currentPingType === 'HOSTILE' ? '#ef4444' : currentPingType === 'FRIEND' ? '#22c55e' : '#eab308'}]}>
                      DÉTAILS {currentPingType === 'HOSTILE' ? 'ADVERSAIRE' : currentPingType === 'FRIEND' ? 'AMI' : 'RENS'}
                  </Text>
                  
                  <Text style={styles.label}>Intitulé (Visible Carte)</Text>
                  <TextInput style={styles.pingInput} placeholder="Ex: Groupe Armé, Sniper..." placeholderTextColor="#52525b" value={pingMsgInput} onChangeText={setPingMsgInput} autoFocus />

                  {currentPingType === 'HOSTILE' && (
                      <ScrollView style={{width: '100%', maxHeight: 200, marginBottom: 10}}>
                          <Text style={styles.label}>Caneva Tactique</Text>
                          <TextInput style={styles.detailInput} placeholder="Attitude (ex: Hostile, Statique)" placeholderTextColor="#52525b" value={hostileDetails.attitude} onChangeText={t => setHostileDetails({...hostileDetails, attitude: t})} />
                          <TextInput style={styles.detailInput} placeholder="Volume (ex: 3 PAX)" placeholderTextColor="#52525b" value={hostileDetails.volume} onChangeText={t => setHostileDetails({...hostileDetails, volume: t})} />
                          <TextInput style={styles.detailInput} placeholder="Armement" placeholderTextColor="#52525b" value={hostileDetails.armes} onChangeText={t => setHostileDetails({...hostileDetails, armes: t})} />
                          <TextInput style={styles.detailInput} placeholder="Tenue / Signes" placeholderTextColor="#52525b" value={hostileDetails.substances} onChangeText={t => setHostileDetails({...hostileDetails, substances: t})} />
                      </ScrollView>
                  )}

                  <View style={{flexDirection: 'row', gap: 10, marginTop: 10}}>
                      <TouchableOpacity onPress={() => setShowPingForm(false)} style={[styles.modalBtn, {backgroundColor: '#27272a'}]}><Text style={{color: 'white'}}>ANNULER</Text></TouchableOpacity>
                      <TouchableOpacity onPress={submitPing} style={[styles.modalBtn, {backgroundColor: '#3b82f6'}]}><Text style={{color: 'white', fontWeight: 'bold'}}>VALIDER</Text></TouchableOpacity>
                  </View>
              </View>
          </KeyboardAvoidingView>
      </Modal>

      {/* --- MODAL PING EDIT (MODIF / SUPPR) --- */}
      <Modal visible={!!editingPing} transparent animationType="slide">
          <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, {width: '90%'}]}>
                  <Text style={styles.modalTitle}>ÉDITION MARQUEUR</Text>
                  
                  <TextInput style={styles.pingInput} value={pingMsgInput} onChangeText={setPingMsgInput} />

                  {editingPing?.type === 'HOSTILE' && (
                      <ScrollView style={{width: '100%', maxHeight: 150}}>
                           <TextInput style={styles.detailInput} placeholder="Attitude" value={hostileDetails.attitude} onChangeText={t => setHostileDetails({...hostileDetails, attitude: t})} />
                           <TextInput style={styles.detailInput} placeholder="Volume" value={hostileDetails.volume} onChangeText={t => setHostileDetails({...hostileDetails, volume: t})} />
                           <TextInput style={styles.detailInput} placeholder="Armement" value={hostileDetails.armes} onChangeText={t => setHostileDetails({...hostileDetails, armes: t})} />
                      </ScrollView>
                  )}

                  <View style={{flexDirection: 'row', gap: 10, marginTop: 20}}>
                      <TouchableOpacity onPress={deletePing} style={[styles.modalBtn, {backgroundColor: '#ef4444'}]}><Text style={{color: 'white'}}>SUPPRIMER</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditingPing(null)} style={[styles.modalBtn, {backgroundColor: '#27272a'}]}><Text style={{color: 'white'}}>ANNULER</Text></TouchableOpacity>
                      <TouchableOpacity onPress={savePingEdit} style={[styles.modalBtn, {backgroundColor: '#22c55e'}]}><Text style={{color: 'white', fontWeight:'bold'}}>SAUVER</Text></TouchableOpacity>
                  </View>
              </View>
          </View>
      </Modal>

      {/* --- AUTRES MODALS (QR, Scanner, QuickMsg) --- */}
      <Modal visible={showQRModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>SESSION TACTIQUE</Text>
            <QRCode value={hostId || user.id || 'NO_ID'} size={200} />
            <Text style={styles.qrId}>{hostId || user.id}</Text>
            <TouchableOpacity onPress={() => setShowQRModal(false)} style={styles.closeBtn}><Text style={styles.closeBtnText}>FERMER</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showScanner} animationType="slide">
        <View style={{flex: 1, backgroundColor: 'black'}}>
          {permission?.granted && <CameraView style={{flex: 1}} onBarcodeScanned={({data}) => { setShowScanner(false); setHostInput(data); setTimeout(() => joinSession(data), 500); }} barcodeScannerSettings={{barcodeTypes: ["qr"]}} />}
          <TouchableOpacity onPress={() => setShowScanner(false)} style={styles.scannerClose}><MaterialIcons name="close" size={30} color="white" /></TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={showQuickMsgModal} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, {maxHeight: '80%'}]}>
                  <Text style={[styles.modalTitle, {color: '#06b6d4'}]}>MESSAGES RAPIDES</Text>
                  <FlatList 
                      data={quickMessagesList} 
                      keyExtractor={(item, index) => index.toString()}
                      renderItem={({item}) => <TouchableOpacity onPress={() => { connectivityService.updateUser({lastMsg: item === "RAS / Effacer" ? "" : item}); setUser(prev => ({...prev, lastMsg: item === "RAS / Effacer" ? "" : item})); setShowQuickMsgModal(false); showToast("Envoyé"); }} style={styles.quickMsgItem}><Text style={styles.quickMsgText}>{item}</Text></TouchableOpacity>} 
                      ItemSeparatorComponent={() => <View style={{height: 1, backgroundColor: '#27272a'}} />}
                  />
                  <TouchableOpacity onPress={() => setShowQuickMsgModal(false)} style={[styles.closeBtn, {backgroundColor: '#27272a'}]}><Text style={{color: '#a1a1aa'}}>FERMER</Text></TouchableOpacity>
              </View>
          </View>
      </Modal>
      
      {incomingNavNotif && <NavNotification message={incomingNavNotif} onDismiss={() => setIncomingNavNotif(null)} />}
      {toast && <View style={[styles.toast, toast.type === 'error' && {backgroundColor: '#ef4444'}]}><Text style={styles.toastText}>{toast.msg}</Text></View>}
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
  modalContent: { width: '100%', backgroundColor: '#18181b', padding: 24, borderRadius: 24, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  modalTitle: { fontSize: 18, fontWeight: '900', marginBottom: 20, color: 'white' },
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
  navNotif: { position: 'absolute', top: 100, left: 20, right: 20, backgroundColor: '#18181b', borderRadius: 12, borderWidth: 1, borderColor: '#06b6d4', padding: 15, flexDirection: 'row', alignItems: 'center', gap: 15, zIndex: 10000, shadowColor: "#000", shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.5, shadowRadius: 10, elevation: 5 },
  navNotifText: { color: 'white', fontWeight: 'bold', flex: 1, fontSize: 14 },
  quickMsgItem: { paddingVertical: 15, paddingHorizontal: 10, width: '100%', alignItems: 'center' },
  quickMsgText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  // NOUVEAUX STYLES PINGS
  pingMenuContainer: { width: '90%', backgroundColor: '#09090b', borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  pingTypeBtn: { width: 90, height: 90, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  label: { color: '#a1a1aa', fontSize: 12, alignSelf: 'flex-start', marginBottom: 5, marginLeft: 5 },
  detailInput: { width: '100%', backgroundColor: '#000', color: 'white', padding: 12, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#333' }
});

export default App;
