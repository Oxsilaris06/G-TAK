import './polyfills'; 
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, 
  SafeAreaView, Platform, Modal, StatusBar as RNStatusBar, Alert, BackHandler, ScrollView, ActivityIndicator,
  PermissionsAndroid, Animated, PanResponder, Dimensions, FlatList, KeyboardAvoidingView
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Peer from 'peerjs';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { useKeepAwake } from 'expo-keep-awake';
import * as Battery from 'expo-battery';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Magnetometer } from 'expo-sensors';
import NetInfo from '@react-native-community/netinfo';
import { Audio } from 'expo-av'; 

import { UserData, OperatorStatus, OperatorRole, ViewType, PingData, AppSettings, DEFAULT_SETTINGS, PingType, HostileDetails } from './types';
import { CONFIG, STATUS_COLORS } from './constants';
import { audioService } from './services/audioService';
import { configService } from './services/configService';
import OperatorCard from './components/OperatorCard';
import TacticalMap from './components/TacticalMap';
import PrivacyConsentModal from './components/PrivacyConsentModal';
import SettingsView from './components/SettingsView';
import OperatorActionModal from './components/OperatorActionModal';

const generateShortId = () => Math.random().toString(36).substring(2, 10).toUpperCase();

// --- COMPOSANT NOTIFICATION PERSISTANTE SWIPABLE ---
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
  const [permission, requestPermission] = useCameraPermissions();

  // --- CONFIGURATION ---
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const [user, setUser] = useState<UserData>({
    id: '', callsign: '', role: OperatorRole.OPR,
    status: OperatorStatus.CLEAR, isTx: false,
    joinedAt: Date.now(), bat: 100, head: 0,
    lat: 0, lng: 0 
  });

  const [view, setView] = useState<ViewType>('login');
  const [lastView, setLastView] = useState<ViewType>('menu'); 

  const [peers, setPeers] = useState<Record<string, UserData>>({});
  const [pings, setPings] = useState<PingData[]>([]);
  const [bannedPeers, setBannedPeers] = useState<string[]>([]);
  
  const [hostId, setHostId] = useState<string>('');
  const [loginInput, setLoginInput] = useState('');
  const [hostInput, setHostInput] = useState('');
  const [pingMsgInput, setPingMsgInput] = useState('');

  const [silenceMode, setSilenceMode] = useState(false);
  const [isPingMode, setIsPingMode] = useState(false);
  const [mapMode, setMapMode] = useState<'dark' | 'light' | 'satellite'>('dark');
  const [showTrails, setShowTrails] = useState(true);
  const [showPings, setShowPings] = useState(true);
  
  const [voxActive, setVoxActive] = useState(false);
  
  const [showQRModal, setShowQRModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  
  // NOUVEAUX ETATS PING
  const [showPingMenu, setShowPingMenu] = useState(false);
  const [showPingForm, setShowPingForm] = useState(false);
  const [currentPingType, setCurrentPingType] = useState<PingType>('FRIEND');
  const [hostileDetails, setHostileDetails] = useState<HostileDetails>({});
  const [editingPing, setEditingPing] = useState<PingData | null>(null);

  const [showQuickMsgModal, setShowQuickMsgModal] = useState(false);
  const [quickMessagesList, setQuickMessagesList] = useState<string[]>([]);

  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null);
  const [tempPingLoc, setTempPingLoc] = useState<any>(null);
  const [privatePeerId, setPrivatePeerId] = useState<string | null>(null);

  const [navTargetId, setNavTargetId] = useState<string | null>(null);
  const [incomingNavNotif, setIncomingNavNotif] = useState<string | null>(null);

  const [hasConsent, setHasConsent] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  
  const [isServicesReady, setIsServicesReady] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'WAITING' | 'OK' | 'ERROR'>('WAITING');

  const [isMigrating, setIsMigrating] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Record<string, any>>({});
  const lastLocationRef = useRef<any>(null);
  const lastHeadBroadcast = useRef<number>(0); 
  const gpsSubscription = useRef<Location.LocationSubscription | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);

  // --- INIT CONFIG ---
  useEffect(() => {
      configService.init().then(s => {
          setSettings(s);
          setQuickMessagesList(s.quickMessages || DEFAULT_SETTINGS.quickMessages);
          audioService.setVoxSensitivity(s.voxSensitivity || 50); 
          if (s.audioOutput === 'hp') audioService.setSpeaker(true);
          else audioService.setSpeaker(false);
          if (s.username) {
            setUser(prev => ({ ...prev, callsign: s.username }));
            setLoginInput(s.username);
          }
      });
      const unsub = configService.subscribe((newSettings) => {
          setSettings(newSettings);
          applySettings(newSettings);
          if (newSettings.quickMessages) setQuickMessagesList(newSettings.quickMessages);
          if (newSettings.username && newSettings.username !== user.callsign) {
              setUser(prev => {
                  const updated = { ...prev, callsign: newSettings.username };
                  if (hostId) broadcast({ type: 'UPDATE_USER', user: updated });
                  return updated;
              });
          }
      });
      setupSound();
      return () => { unsub(); if (soundRef.current) soundRef.current.unloadAsync(); };
  }, []);

  const setupSound = async () => { try { } catch(e) {} };
  const playNotificationSound = async () => { try { if (soundRef.current) { await soundRef.current.replayAsync(); } else { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } } catch (e) {} };

  const applySettings = (s: AppSettings) => {
      if (s.audioOutput === 'hp') audioService.setSpeaker(true);
      else if (s.audioOutput === 'casque') audioService.setSpeaker(false);
      audioService.setVoxSensitivity(s.voxSensitivity);
      if (gpsSubscription.current) startGpsTracking(s.gpsUpdateInterval);
  };

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const offline = !state.isConnected || !state.isInternetReachable;
      if (isOffline && !offline && view !== 'login' && hostId && !isMigrating) {
          showToast("Réseau rétabli. Recon...", "info");
          setTimeout(() => {
              if (user.role === OperatorRole.HOST) initPeer(OperatorRole.HOST, undefined, user.id); 
              else initPeer(OperatorRole.OPR, hostId, user.id); 
          }, 2000);
      }
      setIsOffline(!!offline);
    });
    return unsubscribe;
  }, [isOffline, view, hostId, user.role, isMigrating, user.id]);

  useEffect(() => { const unsubscribe = audioService.subscribe((mode) => { setVoxActive(mode === 'vox'); }); return unsubscribe; }, []);
  useEffect(() => { Battery.getBatteryLevelAsync().then(l => setUser(u => ({ ...u, bat: Math.floor(l * 100) }))); const sub = Battery.addBatteryLevelListener(({ batteryLevel }) => setUser(u => ({ ...u, bat: Math.floor(batteryLevel * 100) }))); return () => sub && sub.remove(); }, []);
  
  useEffect(() => { 
      Magnetometer.setUpdateInterval(100); 
      const sub = Magnetometer.addListener((data) => { 
          let angle = Math.atan2(data.y, data.x) * (180 / Math.PI) - 90; 
          if (angle < 0) angle += 360; 
          setUser(prev => { 
              if (Math.abs(prev.head - angle) > 2) {
                  const newHead = Math.floor(angle);
                  const now = Date.now();
                  if (now - lastHeadBroadcast.current > 300 && hostId) {
                      broadcast({ type: 'UPDATE_USER', user: { ...prev, head: newHead } });
                      lastHeadBroadcast.current = now;
                  }
                  return { ...prev, head: newHead }; 
              }
              return prev; 
          }); 
      }); 
      return () => sub && sub.remove(); 
  }, [hostId]); 
  
  useEffect(() => { const backAction = () => { 
      if (view === 'settings') { setView(lastView); return true; }
      if (selectedOperatorId) { setSelectedOperatorId(null); return true; } 
      if (showQRModal) { setShowQRModal(false); return true; } 
      if (showQuickMsgModal) { setShowQuickMsgModal(false); return true; }
      if (showScanner) { setShowScanner(false); return true; } 
      if (navTargetId) { setNavTargetId(null); showToast("Navigation arrêtée"); return true; }
      if (view === 'ops' || view === 'map') { setView('menu'); return true; } 
      return false; 
  }; const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction); return () => backHandler.remove(); }, [view, user.role, selectedOperatorId, showQRModal, showScanner, lastView, navTargetId, showQuickMsgModal]);

  const showToast = useCallback((msg: string, type: 'info' | 'error' = 'info') => {
    setToast({ msg, type });
    if (type === 'error') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleLogout = async () => {
      if (user.role === OperatorRole.HOST) {
          const candidates = Object.values(peers).filter(p => p.id !== user.id);
          candidates.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
          if (candidates.length > 0) {
              const successor = candidates[0];
              const succConn = connectionsRef.current[successor.id];
              if (succConn) succConn.send({ type: 'HOST_MIGRATE_INSTRUCTION', oldHostId: user.id });
              broadcast({ type: 'HOST_LEAVING_MIGRATE', newHostId: user.id });
              setTimeout(() => { finishLogout(); }, 1500);
              return;
          }
      } else {
          broadcast({ type: 'CLIENT_LEAVING', id: user.id, callsign: user.callsign });
          setTimeout(() => { finishLogout(); }, 500);
          return;
      }
      finishLogout();
  };

  const finishLogout = () => {
      if (peerRef.current) peerRef.current.destroy();
      setPeers({}); setPings([]); setHostId(''); setView('login');
      audioService.stopSession();
      if (gpsSubscription.current) { gpsSubscription.current.remove(); gpsSubscription.current = null; }
      audioService.setTx(false); setBannedPeers([]); setIsServicesReady(false); setIsMigrating(false); setNavTargetId(null); setIncomingNavNotif(null);
  };

  const copyToClipboard = async () => { if (user.id) { await Clipboard.setStringAsync(user.id); showToast("ID Copié"); } };

  const broadcast = useCallback((data: any) => {
    if (!data.type && data.user) data = { type: 'UPDATE', user: data.user };
    data.from = user.id; 
    Object.values(connectionsRef.current).forEach((conn: any) => { if (conn.open) conn.send(data); });
  }, [user.id]);

  const mergePeer = useCallback((newPeer: UserData) => {
    setPeers(prev => {
        const next = { ...prev };
        const oldId = Object.keys(next).find(key => next[key].callsign === newPeer.callsign && key !== newPeer.id);
        if (oldId) delete next[oldId];
        next[newPeer.id] = newPeer;
        return next;
    });
  }, []);

  const handleData = useCallback((data: any, fromId: string) => {
    if (data.from === user.id) return;
    if (data.user && data.user.id === user.id) return;

    switch (data.type) {
      case 'UPDATE': case 'FULL': case 'UPDATE_USER':
        if (data.user && data.user.id !== user.id) mergePeer(data.user);
        break;
      case 'SYNC': 
        const list = data.list || (data.peers ? Object.values(data.peers) : []);
        if (list.length > 0) { list.forEach((u: UserData) => { if(u.id && u.id !== user.id) mergePeer(u); }); }
        if (data.silence !== undefined) setSilenceMode(data.silence);
        break;
      case 'PING':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setPings(prev => [...prev, data.ping]);
        showToast(`ALERTE: ${data.ping.type}`);
        break;
      case 'PING_MOVE': setPings(prev => prev.map(p => p.id === data.id ? { ...p, lat: data.lat, lng: data.lng } : p)); break;
      case 'PING_DELETE': setPings(prev => prev.filter(p => p.id !== data.id)); break;
      case 'PING_UPDATE': setPings(prev => prev.map(p => p.id === data.id ? { ...p, msg: data.msg, details: data.details } : p)); break;
      case 'SILENCE': setSilenceMode(data.state); showToast(data.state ? "SILENCE ACTIF" : "FIN SILENCE"); break;
      case 'CLIENT_LEAVING':
        playNotificationSound();
        showToast(`${data.callsign} déconnecté`, 'info');
        if (privatePeerId === data.id) { leavePrivateMode(); showToast("Fin Canal Privé", 'error'); }
        setPeers(prev => { const next = {...prev}; delete next[data.id]; return next; });
        break;
      case 'HOST_MIGRATE_INSTRUCTION':
          showToast("PRISE DE COMMANDEMENT...", "info"); setIsMigrating(true);
          if (peerRef.current) peerRef.current.destroy();
          setTimeout(() => { initPeer(OperatorRole.HOST, undefined, data.oldHostId); setUser(u => ({ ...u, role: OperatorRole.HOST })); }, 2000);
          break;
      case 'HOST_LEAVING_MIGRATE': showToast("MIGRATION HÔTE...", "info"); setIsMigrating(true); break;
      case 'PRIVATE_REQ':
        Alert.alert("Appel Privé", `Demande de ${data.from}`, [
            { text: "Refuser", style: "cancel" },
            { text: "Accepter", onPress: () => { const conn = connectionsRef.current[data.from]; if (conn) conn.send({ type: 'PRIVATE_ACK', from: user.id }); enterPrivateMode(data.from); }}
        ]);
        break;
      case 'PRIVATE_ACK': enterPrivateMode(data.from); showToast("Canal Privé Établi"); break;
      case 'PRIVATE_END': leavePrivateMode(); showToast("Fin Canal Privé"); break;
      case 'KICK': if (peerRef.current) peerRef.current.destroy(); Alert.alert("Exclu", "Banni par l'Hôte."); handleLogout(); break;
      case 'NAV_NOTIFY': Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); setIncomingNavNotif(`${data.callsign} se dirige vers votre position.`); break;
    }
  }, [user.id, showToast, mergePeer, privatePeerId]);

  const enterPrivateMode = (targetId: string) => { setPrivatePeerId(targetId); setUser(u => ({ ...u, status: OperatorStatus.BUSY })); broadcast({ type: 'UPDATE', user: { ...user, status: OperatorStatus.BUSY } }); };
  const leavePrivateMode = () => { setPrivatePeerId(null); setUser(u => ({ ...u, status: OperatorStatus.CLEAR })); broadcast({ type: 'UPDATE', user: { ...user, status: OperatorStatus.CLEAR } }); };

  const handleKickUser = (targetId: string) => {
      const conn = connectionsRef.current[targetId];
      if (conn) conn.send({ type: 'KICK', from: user.id });
      setBannedPeers(prev => [...prev, targetId]);
      if (conn) conn.close();
      delete connectionsRef.current[targetId];
      setPeers(prev => { const next = {...prev}; delete next[targetId]; return next; });
      setSelectedOperatorId(null);
      showToast("Utilisateur Banni");
  };

  const handleRequestPrivate = (targetId: string) => {
      const conn = connectionsRef.current[targetId];
      if(conn) { conn.send({ type: 'PRIVATE_REQ', from: user.id }); showToast("Demande envoyée"); } else { showToast("Erreur de connexion", "error"); }
      setSelectedOperatorId(null);
  };

  const handleStartNavigation = (targetId: string) => {
      setSelectedOperatorId(null); setNavTargetId(targetId); setView('map');
      const conn = connectionsRef.current[targetId];
      if (conn) conn.send({ type: 'NAV_NOTIFY', callsign: user.callsign });
      showToast("Guidage Tactique Activé");
  };

  const sendQuickMessage = (msg: string) => {
      const finalMsg = msg === "RAS / Effacer" ? "" : msg;
      setUser(prev => { const updated = { ...prev, lastMsg: finalMsg }; broadcast({ type: 'UPDATE', user: updated }); return updated; });
      setShowQuickMsgModal(false);
      showToast(finalMsg ? "Message transmis" : "Message effacé");
  };

  const initPeer = useCallback((initialRole: OperatorRole, targetHostId?: string, overrideId?: string) => {
    if (peerRef.current) peerRef.current.destroy();
    const myId = overrideId ? overrideId : (initialRole === OperatorRole.HOST ? generateShortId() : undefined);
    const p = new Peer(myId, CONFIG.PEER_CONFIG as any);
    peerRef.current = p;

    p.on('open', (pid) => {
      setIsMigrating(false); setUser(prev => ({ ...prev, id: pid }));
      if (initialRole === OperatorRole.HOST) { setHostId(pid); showToast(`HÔTE: ${pid}`); } 
      else if (targetHostId) { connectToHost(targetHostId); }
    });

    p.on('connection', (conn) => {
      if (bannedPeers.includes(conn.peer)) { conn.close(); return; }
      connectionsRef.current[conn.peer] = conn;
      conn.on('data', (data: any) => handleData(data, conn.peer));
      conn.on('open', () => {
        if (user.role === OperatorRole.HOST || initialRole === OperatorRole.HOST) {
          const list = Object.values(peers); list.push(user);
          conn.send({ type: 'SYNC', list: list, silence: silenceMode });
          pings.forEach(ping => conn.send({ type: 'PING', ping }));
        }
      });
      conn.on('close', () => { if (privatePeerId === conn.peer) { leavePrivateMode(); showToast("Fin Canal Privé", 'error'); } setPeers(prev => { const next = {...prev}; delete next[conn.peer]; return next; }); });
    });

    p.on('call', (call) => {
      if (call.peer === peerRef.current?.id || call.peer === user.id) return;
      if (!audioService.stream) return;
      call.answer(audioService.stream);
      call.on('stream', (rs) => { if (call.peer === peerRef.current?.id) return; audioService.playStream(rs); });
    });
    
    p.on('error', (err) => { if (err.type === 'unavailable-id' && isMigrating) setTimeout(() => initPeer(initialRole, targetHostId, overrideId), 1000); });
  }, [peers, user, handleData, showToast, silenceMode, pings, bannedPeers, isMigrating, privatePeerId]);

  const connectToHost = useCallback((targetId: string) => {
    if (targetId === user.id || targetId === peerRef.current?.id) return;
    if (!peerRef.current || !audioService.stream) return;
    if (hostId && connectionsRef.current[hostId]) connectionsRef.current[hostId].close();
    setHostId(targetId);
    
    const conn = peerRef.current.connect(targetId);
    connectionsRef.current[targetId] = conn;
    
    conn.on('open', () => {
      setIsMigrating(false); showToast(`CONNECTÉ À ${targetId}`); conn.send({ type: 'FULL', user: user });
      const call = peerRef.current!.call(targetId, audioService.stream!);
      call.on('stream', (rs) => { if (targetId === peerRef.current?.id) return; audioService.playStream(rs); });
    });
    
    conn.on('data', (data: any) => handleData(data, targetId));
    conn.on('close', () => { if ((view === 'ops' || view === 'map') && !isMigrating) handleHostDisconnect(); else if (isMigrating) setTimeout(() => connectToHost(targetId), 2000); else showToast("Déconnecté", "error"); });
    conn.on('error', () => { if (isMigrating) setTimeout(() => connectToHost(targetId), 2000); else handleHostDisconnect(); });
  }, [user, handleData, showToast, hostId, view, isMigrating]);

  const handleHostDisconnect = () => {
      if (user.role === OperatorRole.HOST) return;
      showToast("CONNEXION PERDUE...", "error");
      setTimeout(() => {
          if (!isMigrating) {
            const candidates = Object.values(peers).filter(p => p.id !== hostId && p.id !== user.id);
            candidates.push(user); candidates.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
            const newHost = candidates[0];
            if (newHost && newHost.id === user.id) { promoteToHost(); } 
            else if (newHost) { setTimeout(() => { connectToHost(newHost.id); }, 500 + Math.random() * 1000); }
          }
      }, 5000);
  };

  const promoteToHost = () => { setUser(prev => ({ ...prev, role: OperatorRole.HOST })); setHostId(user.id); showToast("JE SUIS HÔTE", "info"); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); };

  const checkAllPermissions = async () => {
      if (Platform.OS === 'android') {
        try {
            const permsToRequest = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION];
            if (Platform.Version >= 33) permsToRequest.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
            if (Platform.Version >= 31) { permsToRequest.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT); permsToRequest.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN); }
            const results = await PermissionsAndroid.requestMultiple(permsToRequest);
            if (results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== PermissionsAndroid.RESULTS.GRANTED) showToast("Microphone refusé", "error");
        } catch (err) { console.warn("Permissions Error", err); }
      }
  };

  const startGpsTracking = async (interval: number) => {
      if (gpsSubscription.current) gpsSubscription.current.remove();
      gpsSubscription.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: interval, distanceInterval: 10 }, (loc) => {
            const { latitude, longitude, speed, heading, accuracy } = loc.coords;
            if (accuracy && accuracy > 50) return;
            setGpsStatus('OK');
            setUser(prev => {
                const gpsHead = (speed && speed > 1 && heading !== null) ? heading : prev.head;
                const newUser = { ...prev, lat: latitude, lng: longitude, head: gpsHead };
                if (!lastLocationRef.current || Math.abs(latitude - lastLocationRef.current.lat) > 0.0001 || Math.abs(longitude - lastLocationRef.current.lng) > 0.0001) {
                    broadcast({ type: 'UPDATE', user: newUser });
                    lastLocationRef.current = { lat: latitude, lng: longitude };
                }
                return newUser;
            });
      });
  };

  const startServices = async () => {
    if (!hasConsent || isServicesReady) return;
    try {
        await checkAllPermissions();
        const audioInitResult = await audioService.init();
        if (!audioInitResult) { showToast("Erreur Audio", "error"); return; }
        audioService.startMetering((state) => {
          const isTransmitting = state === 1;
          if (isTransmitting !== user.isTx) {
             if (silenceMode && user.role !== OperatorRole.HOST) return;
             setUser(prev => { const u = { ...prev, isTx: isTransmitting }; broadcast({ type: 'UPDATE', user: u }); return u; });
          }
        });
        const locationStatus = await Location.getForegroundPermissionsAsync();
        if (locationStatus.granted) {
            try { const initialLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }); if (initialLoc && initialLoc.coords) { setUser(prev => ({ ...prev, lat: initialLoc.coords.latitude, lng: initialLoc.coords.longitude })); setGpsStatus('OK'); } } catch (e) {}
            startGpsTracking(settings.gpsUpdateInterval);
        } else { setGpsStatus('ERROR'); showToast("GPS Off", "error"); }
        if (!permission?.granted) requestPermission();
        setIsServicesReady(true);
    } catch (e) { showToast("Erreur Services", "error"); }
  };

  useEffect(() => { if (hasConsent && user.callsign && view !== 'login') startServices(); }, [hasConsent, view]); 

  const handleLogin = async () => {
    const tri = loginInput.toUpperCase();
    if (tri.length < 2) return;
    try { await AsyncStorage.setItem(CONFIG.TRIGRAM_STORAGE_KEY, tri); } catch (e) {}
    if (tri !== settings.username) configService.update({ username: tri });
    setUser(prev => ({ ...prev, callsign: tri }));
    setView('menu');
  };

  const joinSession = (id?: string) => {
    const finalId = id || hostInput.toUpperCase();
    if (!finalId) return;
    setHostId(finalId);
    const role = OperatorRole.OPR;
    setUser(prev => ({ ...prev, role }));
    audioService.startSession(`CANAL ${finalId}`);
    initPeer(role, finalId);
    setView('ops');
  };

  const handleScannerBarCodeScanned = ({ data }: any) => { setShowScanner(false); setHostInput(data); setTimeout(() => joinSession(data), 500); };
  const openSettings = () => { setLastView(view); setView('settings'); };

  // --- LOGIQUE PING CARTE ---
  const handleMapPing = (loc: {lat: number, lng: number}) => {
      setTempPingLoc(loc);
      setShowPingMenu(true);
  };

  const selectPingType = (type: PingType) => {
      setCurrentPingType(type);
      setShowPingMenu(false);
      setPingMsgInput('');
      setHostileDetails({});
      setShowPingForm(true);
  };

  const submitPing = () => {
      if (!tempPingLoc) return;
      const newPing: PingData = {
          id: Math.random().toString(36).substr(2, 9), lat: tempPingLoc.lat, lng: tempPingLoc.lng,
          msg: pingMsgInput || (currentPingType === 'HOSTILE' ? 'ENNEMI' : currentPingType === 'FRIEND' ? 'AMI' : 'RENS'),
          type: currentPingType, sender: user.callsign, timestamp: Date.now(),
          details: currentPingType === 'HOSTILE' ? hostileDetails : undefined
      };
      setPings(prev => [...prev, newPing]);
      broadcast({ type: 'PING', ping: newPing });
      setShowPingForm(false); setTempPingLoc(null);
  };

  const handlePingEdit = (id: string) => {
      const p = pings.find(pi => pi.id === id);
      if(!p) return;
      // Pour les autres utilisateurs, seule une notification si ce n'est pas le leur
      if (user.role !== OperatorRole.HOST && p.sender !== user.callsign) {
          showToast(`Ping de ${p.sender}`, 'info');
          return;
      }
      setEditingPing(p);
      setPingMsgInput(p.msg);
      if(p.details) setHostileDetails(p.details);
  };
  
  const savePingEdit = () => {
      if (!editingPing) return;
      const updatedPing = { ...editingPing, msg: pingMsgInput, details: editingPing.type === 'HOSTILE' ? hostileDetails : undefined };
      setPings(prev => prev.map(p => p.id === editingPing.id ? updatedPing : p));
      broadcast({ type: 'PING_UPDATE', id: editingPing.id, msg: pingMsgInput, details: updatedPing.details });
      setEditingPing(null);
  };
  const deletePing = () => {
      if (!editingPing) return;
      setPings(prev => prev.filter(p => p.id !== editingPing.id));
      broadcast({ type: 'PING_DELETE', id: editingPing.id });
      setEditingPing(null);
  };

  const renderLogin = () => (
    <View style={styles.centerContainer}>
      <MaterialIcons name="login" size={80} color="#3b82f6" style={{opacity: 0.8, marginBottom: 30}} />
      <Text style={styles.title}>Tac<Text style={{color: '#3b82f6'}}>Suite</Text></Text>
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
                <TouchableOpacity onPress={openSettings} style={{padding: 5}}><MaterialIcons name="settings" size={24} color="#a1a1aa" /></TouchableOpacity>
                <TouchableOpacity onPress={() => Alert.alert("Déconnexion", "Se déconnecter ?", [{text:"Non"}, {text:"Oui", onPress:handleLogout}])} style={{padding: 5}}><MaterialIcons name="power-settings-new" size={24} color="#ef4444" /></TouchableOpacity>
            </View>
        </View>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 20, backgroundColor: '#18181b', padding: 10, borderRadius: 8}}>
                {isServicesReady ? (<MaterialIcons name="check-circle" size={16} color="#22c55e" />) : (<ActivityIndicator size="small" color="#3b82f6" />)}
                <Text style={{color: '#71717a', fontSize: 10, marginRight: 10}}>SYS</Text>
                {gpsStatus === 'OK' ? <MaterialIcons name="gps-fixed" size={16} color="#22c55e" /> : <MaterialIcons name="gps-not-fixed" size={16} color="#eab308" />}
                <Text style={{color: '#71717a', fontSize: 10}}>GPS</Text>
        </View>
        
        {isSessionActive ? (
            <View>
                <TouchableOpacity onPress={() => setView('ops')} style={[styles.menuCard, {borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.1)'}]}>
                  <MaterialIcons name="play-circle-filled" size={40} color="#22c55e" />
                  <View style={{marginLeft: 20}}><Text style={[styles.menuCardTitle, {color: '#22c55e'}]}>RETOURNER AU SALON</Text><Text style={styles.menuCardSubtitle}>{hostId}</Text></View>
                </TouchableOpacity>
                <View style={styles.divider} />
                <TouchableOpacity onPress={() => Alert.alert("Fin", "Quitter ?", [{text:"Non"}, {text:"Oui", onPress:handleLogout}])} style={[styles.menuCard, {borderColor: '#ef4444'}]}>
                  <MaterialIcons name="stop-circle" size={40} color="#ef4444" />
                  <View style={{marginLeft: 20}}><Text style={[styles.menuCardTitle, {color: '#ef4444'}]}>TERMINER MISSION</Text></View>
                </TouchableOpacity>
            </View>
        ) : (
            <>
                <TouchableOpacity onPress={() => { const role = OperatorRole.HOST; setUser(prev => ({ ...prev, role })); audioService.startSession("QG TACTIQUE"); initPeer(role); setView('ops'); }} style={styles.menuCard}>
                  <MaterialIcons name="add-circle" size={40} color="#3b82f6" />
                  <View style={{marginLeft: 20}}><Text style={styles.menuCardTitle}>Créer Salon</Text><Text style={styles.menuCardSubtitle}>Hôte</Text></View>
                </TouchableOpacity>
                <View style={styles.divider} />
                <View style={styles.joinHeader}><Text style={styles.sectionTitle}>REJOINDRE</Text><TouchableOpacity onPress={() => setShowScanner(true)} style={styles.scanBtn}><MaterialIcons name="qr-code-scanner" size={16} color="#3b82f6" /><Text style={styles.scanBtnText}>SCANNER</Text></TouchableOpacity></View>
                <TextInput style={styles.inputBox} placeholder="ID CANAL..." placeholderTextColor="#52525b" value={hostInput} onChangeText={setHostInput} autoCapitalize="characters" />
                <TouchableOpacity onPress={() => joinSession()} style={styles.joinBtn}><Text style={styles.joinBtnText}>REJOINDRE</Text></TouchableOpacity>
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
              <TouchableOpacity onPress={() => setView('menu')} style={{padding: 8, marginRight: 10}}><MaterialIcons name="arrow-back" size={24} color="#a1a1aa" /></TouchableOpacity>
              <View style={{flexDirection: 'row', alignItems: 'center', flex: 1}}>
                <MaterialIcons name="satellite" size={20} color="#3b82f6" />
                <Text style={styles.headerTitle}> Tac<Text style={{color: '#3b82f6'}}>Suite</Text></Text>
              </View>
              <TouchableOpacity onPress={openSettings} style={{padding: 8, marginRight: 5}}><MaterialIcons name="settings" size={24} color="#a1a1aa" /></TouchableOpacity>
              <TouchableOpacity onPress={() => setView(view === 'map' ? 'ops' : 'map')} style={[styles.navBtn, view === 'map' ? styles.navBtnActive : null]}>
                <MaterialIcons name="map" size={16} color={view === 'map' ? 'white' : '#a1a1aa'} />
                <Text style={[styles.navBtnText, view === 'map' ? {color:'white'} : null]}>MAP</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
          {silenceMode && (<View style={styles.silenceBanner}><Text style={styles.silenceText}>SILENCE RADIO</Text></View>)}
          {privatePeerId && (<View style={[styles.silenceBanner, {backgroundColor: '#a855f7'}]}><Text style={styles.silenceText}>CANAL PRIVÉ ACTIF</Text></View>)}
          {isOffline && (<View style={[styles.silenceBanner, {backgroundColor: '#ef4444'}]}><Text style={styles.silenceText}>CONNEXION PERDUE...</Text></View>)}
          {isMigrating && (<View style={[styles.silenceBanner, {backgroundColor: '#eab308'}]}><Text style={styles.silenceText}>MIGRATION HÔTE...</Text></View>)}
      </View>

      <View style={styles.mainContent}>
        {view === 'ops' ? (
          <ScrollView contentContainerStyle={styles.grid}>
             <OperatorCard user={user} isMe style={{ width: '100%' }} />
             {Object.values(peers).filter(p => p.id !== user.id).map(p => (
                 <TouchableOpacity key={p.id} onLongPress={() => setSelectedOperatorId(p.id)} activeOpacity={0.8} style={{ width: '48%', marginBottom: 10 }}>
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
                  onPing={handleMapPing}
                  onPingMove={(p) => { setPings(prev => prev.map(pi => pi.id === p.id ? p : pi)); broadcast({ type: 'PING_MOVE', id: p.id, lat: p.lat, lng: p.lng }); }}
                  onPingClick={(id) => handlePingEdit(id)}
                  onNavStop={() => { setNavTargetId(null); showToast("Navigation arrêtée"); }} 
                />
             ) : (
                <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000'}}>
                    <ActivityIndicator size="large" color="#3b82f6" />
                    <Text style={{color: 'white', marginTop: 20}}>Acquisition signal GPS...</Text>
                </View>
             )}
            <View style={styles.mapControls}>
                <TouchableOpacity onPress={() => setMapMode(m => m === 'dark' ? 'light' : m === 'light' ? 'satellite' : 'dark')} style={styles.mapBtn}><MaterialIcons name={mapMode === 'dark' ? 'dark-mode' : mapMode === 'light' ? 'light-mode' : 'satellite'} size={24} color="#d4d4d8" /></TouchableOpacity>
                <TouchableOpacity onPress={() => setShowTrails(!showTrails)} style={styles.mapBtn}><MaterialIcons name={showTrails ? 'visibility' : 'visibility-off'} size={24} color="#d4d4d8" /></TouchableOpacity>
                <TouchableOpacity onPress={() => setShowPings(!showPings)} style={styles.mapBtn}><MaterialIcons name={showPings ? 'location-on' : 'location-off'} size={24} color="#d4d4d8" /></TouchableOpacity>
                <TouchableOpacity onPress={() => setIsPingMode(!isPingMode)} style={[styles.mapBtn, isPingMode ? {backgroundColor: '#dc2626', borderColor: '#f87171'} : null]}><MaterialIcons name="ads-click" size={24} color="white" /></TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.statusRow}>
            {user.role === OperatorRole.HOST && (
               <TouchableOpacity onPress={() => { const ns = !silenceMode; setSilenceMode(ns); broadcast({ type: 'SILENCE', state: ns }); if(ns) {setVoxActive(false); audioService.setTx(false);} }} style={[styles.statusBtn, silenceMode ? {backgroundColor: '#ef4444'} : {borderColor: '#ef4444'}]}>
                   <Text style={[styles.statusBtnText, silenceMode ? {color:'white'} : {color: '#ef4444'}]}>SILENCE</Text>
               </TouchableOpacity>
            )}
            {privatePeerId && (
                <TouchableOpacity onPress={() => { const conn = connectionsRef.current[privatePeerId]; if(conn) conn.send({type: 'PRIVATE_END'}); leavePrivateMode(); }} style={[styles.statusBtn, {borderColor: '#a855f7'}]}><Text style={[styles.statusBtnText, {color: '#a855f7'}]}>QUITTER PRIVÉ</Text></TouchableOpacity>
            )}
            {!privatePeerId && [OperatorStatus.PROGRESSION, OperatorStatus.CONTACT, OperatorStatus.CLEAR].map(s => (
                <TouchableOpacity key={s} onPress={() => { setUser(prev => { const updated = { ...prev, status: s }; broadcast({ type: 'UPDATE', user: updated }); return updated; }); }} style={[styles.statusBtn, user.status === s ? { backgroundColor: STATUS_COLORS[s], borderColor: 'white' } : null]}>
                    <Text style={[styles.statusBtnText, user.status === s ? {color:'white'} : null]}>{s}</Text>
                </TouchableOpacity>
            ))}
            {!privatePeerId && (
                <TouchableOpacity onPress={() => setShowQuickMsgModal(true)} style={[styles.statusBtn, {borderColor: '#06b6d4'}]}><Text style={[styles.statusBtnText, {color: '#06b6d4'}]}>MSG</Text></TouchableOpacity>
            )}
        </View>
        <View style={styles.controlsRow}>
            <TouchableOpacity onPress={() => audioService.toggleVox()} style={[styles.voxBtn, voxActive ? {backgroundColor:'#16a34a'} : null]}><MaterialIcons name={voxActive ? 'mic' : 'mic-none'} size={24} color={voxActive ? 'white' : '#a1a1aa'} /></TouchableOpacity>
            <TouchableOpacity onPressIn={() => { if(silenceMode && user.role !== OperatorRole.HOST) return; if(!voxActive) { if (user.role !== OperatorRole.HOST) audioService.muteIncoming(true); audioService.setTx(true); setUser(prev => { const u = {...prev, isTx:true}; broadcast({type:'UPDATE', user:u}); return u; }); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } }} onPressOut={() => { if(!voxActive) { audioService.setTx(false); if (user.role !== OperatorRole.HOST) audioService.muteIncoming(false); setUser(prev => { const u = {...prev, isTx:false}; broadcast({type:'UPDATE', user:u}); return u; }); } }} style={[styles.pttBtn, user.isTx ? {backgroundColor: '#2563eb'} : null, silenceMode && user.role !== OperatorRole.HOST ? {opacity:0.5} : null]} disabled={silenceMode && user.role !== OperatorRole.HOST}>
                <MaterialIcons name="mic" size={40} color={user.isTx ? 'white' : '#3f3f46'} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowQRModal(true)} style={styles.qrBtn}><MaterialIcons name="qr-code-2" size={24} color="#d4d4d8" /></TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor="#000" />
      <PrivacyConsentModal onConsentGiven={() => setHasConsent(true)} />

      {view === 'login' ? renderLogin() :
       view === 'menu' ? renderMenu() :
       view === 'settings' ? <SettingsView onClose={() => setView(lastView)} /> :
       renderDashboard()}

      <OperatorActionModal 
          visible={!!selectedOperatorId} targetOperator={peers[selectedOperatorId || ''] || null}
          currentUserRole={user.role} onClose={() => setSelectedOperatorId(null)}
          onPrivateCall={(id) => handleRequestPrivate(id)} onKick={(id) => handleKickUser(id)}
          onNavigate={(id) => handleStartNavigation(id)}
      />

      <Modal visible={showQRModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>MON IDENTITY TAG</Text>
            <QRCode value={user.id || 'NO_ID'} size={200} />
            <TouchableOpacity onPress={copyToClipboard}><Text style={styles.qrId}>{user.id}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setShowQRModal(false)} style={styles.closeBtn}><Text style={styles.closeBtnText}>FERMER</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showScanner} animationType="slide">
        <View style={{flex: 1, backgroundColor: 'black'}}>
          <CameraView style={{flex: 1}} onBarcodeScanned={handleScannerBarCodeScanned} barcodeScannerSettings={{barcodeTypes: ["qr"]}} />
          <TouchableOpacity onPress={() => setShowScanner(false)} style={styles.scannerClose}><MaterialIcons name="close" size={30} color="white" /></TouchableOpacity>
        </View>
      </Modal>

      {/* MODAL MENU TYPE DE PING */}
      <Modal visible={showPingMenu} transparent animationType="fade">
          <View style={styles.modalOverlay}>
              <View style={styles.pingMenuContainer}>
                  <Text style={styles.modalTitle}>TYPE DE MARQUEUR</Text>
                  <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 15, justifyContent: 'center'}}>
                      <TouchableOpacity onPress={() => selectPingType('HOSTILE')} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444'}]}><MaterialIcons name="warning" size={30} color="#ef4444" /><Text style={{color: '#ef4444', fontWeight: 'bold', fontSize: 10, marginTop: 5}}>ADVERSAIRE</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => selectPingType('FRIEND')} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(34, 197, 94, 0.2)', borderColor: '#22c55e'}]}><MaterialIcons name="shield" size={30} color="#22c55e" /><Text style={{color: '#22c55e', fontWeight: 'bold', fontSize: 10, marginTop: 5}}>AMI</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => selectPingType('INTEL')} style={[styles.pingTypeBtn, {backgroundColor: 'rgba(234, 179, 8, 0.2)', borderColor: '#eab308'}]}><MaterialIcons name="visibility" size={30} color="#eab308" /><Text style={{color: '#eab308', fontWeight: 'bold', fontSize: 10, marginTop: 5}}>RENS</Text></TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => setShowPingMenu(false)} style={[styles.closeBtn, {marginTop: 20, backgroundColor: '#27272a'}]}><Text style={{color:'white'}}>ANNULER</Text></TouchableOpacity>
              </View>
          </View>
      </Modal>

      {/* MODAL FORMULAIRE PING */}
      <Modal visible={showPingForm} transparent animationType="slide">
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
              <View style={[styles.modalContent, {width: '90%', maxHeight: '80%'}]}>
                  <Text style={[styles.modalTitle, {color: currentPingType === 'HOSTILE' ? '#ef4444' : currentPingType === 'FRIEND' ? '#22c55e' : '#eab308'}]}>{currentPingType === 'HOSTILE' ? 'ADVERSAIRE' : currentPingType === 'FRIEND' ? 'AMI' : 'RENS'}</Text>
                  <Text style={styles.label}>Titre / Info Rapide</Text>
                  <TextInput style={styles.pingInput} placeholder="Intitulé" placeholderTextColor="#52525b" value={pingMsgInput} onChangeText={setPingMsgInput} autoFocus={currentPingType !== 'HOSTILE'} />
                  
                  {currentPingType === 'HOSTILE' && (
                      <ScrollView style={{width: '100%', maxHeight: 300, marginBottom: 10}}>
                          <Text style={[styles.label, {color: '#ef4444', marginTop: 10}]}>Détails (Caneva)</Text>
                          <TextInput style={styles.detailInput} placeholder="Position (Coord/Lieu)" placeholderTextColor="#52525b" value={hostileDetails.position} onChangeText={t => setHostileDetails({...hostileDetails, position: t})} />
                          <TextInput style={styles.detailInput} placeholder="Nature (Type d'ennemi)" placeholderTextColor="#52525b" value={hostileDetails.nature} onChangeText={t => setHostileDetails({...hostileDetails, nature: t})} />
                          <TextInput style={styles.detailInput} placeholder="Attitude (Statique/Mobile)" placeholderTextColor="#52525b" value={hostileDetails.attitude} onChangeText={t => setHostileDetails({...hostileDetails, attitude: t})} />
                          <TextInput style={styles.detailInput} placeholder="Volume (Nombre)" placeholderTextColor="#52525b" value={hostileDetails.volume} onChangeText={t => setHostileDetails({...hostileDetails, volume: t})} />
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

      {/* MODAL EDIT PING (ICONES SEULEMENT) */}
      <Modal visible={!!editingPing} transparent animationType="slide">
          <KeyboardAvoidingView behavior="padding" style={styles.modalOverlay}>
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

                  <View style={{flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginTop: 10}}>
                      {/* BOUTON SUPPRIMER (ROUGE) */}
                      <TouchableOpacity onPress={deletePing} style={styles.iconBtnDanger}>
                          <MaterialIcons name="delete" size={28} color="white" />
                      </TouchableOpacity>

                      {/* BOUTON ANNULER (GRIS) */}
                      <TouchableOpacity onPress={() => setEditingPing(null)} style={styles.iconBtnSecondary}>
                          <MaterialIcons name="close" size={28} color="white" />
                      </TouchableOpacity>

                      {/* BOUTON SAUVER (VERT) */}
                      <TouchableOpacity onPress={savePingEdit} style={styles.iconBtnSuccess}>
                          <MaterialIcons name="check" size={28} color="white" />
                      </TouchableOpacity>
                  </View>
              </View>
          </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showQuickMsgModal} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, {backgroundColor: '#18181b', borderWidth: 1, borderColor: '#333', maxHeight: '80%'}]}>
                  <Text style={[styles.modalTitle, {color: '#06b6d4', marginBottom: 15}]}>MESSAGE RAPIDE</Text>
                  <FlatList 
                      data={quickMessagesList} keyExtractor={(item, index) => index.toString()}
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
  footer: { backgroundColor: '#050505', borderTopWidth: 1, borderTopColor: '#27272a', paddingBottom: 40 },
  statusRow: { flexDirection: 'row', padding: 12, gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  statusBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#27272a' },
  statusBtnText: { color: '#71717a', fontSize: 10, fontWeight: 'bold' },
  controlsRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 30, marginTop: 10 },
  voxBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#18181b', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#27272a' },
  pttBtn: { width: 90, height: 90, borderRadius: 30, backgroundColor: '#18181b', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#27272a' },
  qrBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#18181b', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#27272a' },
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
  navNotif: { position: 'absolute', top: 100, left: 20, right: 20, backgroundColor: '#18181b', borderRadius: 12, borderWidth: 1, borderColor: '#06b6d4', padding: 15, flexDirection: 'row', alignItems: 'center', gap: 15, zIndex: 10000, elevation: 5 },
  navNotifText: { color: 'white', fontWeight: 'bold', flex: 1, fontSize: 14 },
  quickMsgItem: { paddingVertical: 15, paddingHorizontal: 10, width: '100%', alignItems: 'center' },
  quickMsgText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  pingMenuContainer: { width: '85%', backgroundColor: '#09090b', borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#333' },
  pingTypeBtn: { width: 80, height: 80, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  label: { color: '#a1a1aa', fontSize: 12, alignSelf: 'flex-start', marginBottom: 5, marginLeft: 5 },
  detailInput: { width: '100%', backgroundColor: '#000', color: 'white', padding: 12, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#333' },
  
  // BOUTONS ICONES MODALE
  iconBtnDanger: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  iconBtnSecondary: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#52525b', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  iconBtnSuccess: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#22c55e', justifyContent: 'center', alignItems: 'center', elevation: 5 }
});
export default App;
