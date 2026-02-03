import './polyfills';
import React, { useCallback, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  Modal,
  StatusBar as RNStatusBar,
  Alert,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  AppState,
  FlatList,
  useWindowDimensions,
  Dimensions,
  Image,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import QRCode from 'react-native-qrcode-svg';
import { Camera, CameraView } from 'expo-camera';
import * as Notifications from 'expo-notifications';
import { useKeepAwake } from 'expo-keep-awake';
import * as Clipboard from 'expo-clipboard';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as SplashScreen from 'expo-splash-screen';
import * as Battery from 'expo-battery';
import { Magnetometer } from 'expo-sensors';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

import {
  UserData,
  OperatorStatus,
  OperatorRole,
  ViewType,
  PingData,
  LogEntry,
  HostileDetails,
} from './types';
import { CONFIG, STATUS_COLORS } from './constants';

// Services
import { configService } from './services/configService';
import { connectivityService } from './services/connectivityService';
import { locationService } from './services/locationService';
import { permissionService } from './services/permissionService';
import { mmkvStorage } from './services/mmkvStorage';

// Store Zustand
import {
  usePraxisStore,
  useUser,
  useNetwork,
  useMapState,
  useUI,
  usePings,
  useLogs,
  useSettings,
  useActions,
} from './store/usePraxisStore';

// Components
import OperatorCard from './components/OperatorCard';
import TacticalMap from './components/TacticalMap';
import SettingsView from './components/SettingsView';
import OperatorActionModal from './components/OperatorActionModal';
import MainCouranteView from './components/MainCouranteView';
import PrivacyConsentModal from './components/PrivacyConsentModal';
import { NotificationToast } from './components/NotificationToast';
import ComposantOrdreInitial from './components/ComposantOrdreInitial';
import TacticalBackground from './components/TacticalBackground';
import UpdateNotifier from './components/UpdateNotifier';

try {
  SplashScreen.preventAutoHideAsync().catch(() => {});
} catch (e) {}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const App: React.FC = () => {
  useKeepAwake();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Store selectors
  const isAppReady = usePraxisStore((s) => s.isAppReady);
  const user = useUser();
  const network = useNetwork();
  const map = useMapState();
  const ui = useUI();
  const ping = usePings();
  const logs = useLogs();
  const settings = useSettings();
  const actions = useActions();

  // Refs
  const magSubscription = useRef<any>(null);
  const lastSentHead = useRef<number>(0);
  const userRef = useRef(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Toast notification
  const showToast = useCallback(
    (msg: string, type: 'info' | 'error' | 'success' | 'warning' = 'info') => {
      actions.showNotification(msg, type);
      if (type === 'error' || type === 'warning')
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      else if (type === 'success')
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    [actions]
  );

  // Notification tactique
  const triggerTacticalNotification = async (title: string, body: string) => {
    if (
      AppState.currentState !== 'background' ||
      settings.disableBackgroundNotifications
    )
      return;
    await Notifications.dismissAllNotificationsAsync();
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        color: '#000000',
      },
      trigger: null,
    });
  };

  // Broadcast sécurisé
  const safeBroadcast = async (data: any, critical: boolean = false) => {
    try {
      if (critical && connectivityService.broadcastWithAck) {
        await connectivityService.broadcastWithAck(data);
      } else {
        connectivityService.broadcast(data);
      }
    } catch (e) {
      console.error('[App] Broadcast failed:', e);
      showToast("Erreur réseau - données en file d'attente", 'warning');
    }
  };

  // Gestion photo
  const handleTakePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showToast('Permission caméra refusée', 'error');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
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

  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast('Permission galerie refusée', 'error');
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
      const manipResult = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: CONFIG.MAX_IMAGE_SIZE } }],
        {
          compress: CONFIG.IMAGE_COMPRESSION,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        }
      );
      actions.setTempImage(`data:image/jpeg;base64,${manipResult.base64}`);
    } catch (error) {
      console.error('Erreur compression image', error);
      showToast('Erreur traitement image', 'error');
    }
  };

  // Initialisation
  useEffect(() => {
    let mounted = true;

    const initApp = async () => {
      try {
        // Init config
        const s = await configService.init();
        if (mounted) {
          actions.updateSettings(s);
          if (s.username) {
            actions.setUser({
              callsign: s.username,
              paxColor: s.userArrowColor,
            });
          }
          actions.setQuickMessages(s.quickMessages || DEFAULT_SETTINGS.quickMessages);
        }
      } catch (e) {
        console.log('Config Error:', e);
      }

      // Permissions
      try {
        const permResult = await permissionService.requestAllPermissions();
        if (!permResult.location) {
          showToast('Permission GPS refusée', 'warning');
        }
        await Camera.requestCameraPermissionsAsync();
      } catch (e) {
        console.log('Perm Error:', e);
      }

      // Battery
      try {
        const level = await Battery.getBatteryLevelAsync();
        if (mounted && level) {
          actions.setUserBattery(Math.round(level * 100));
        }
      } catch (e) {}

      if (mounted) {
        actions.setAppReady(true);
        setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 500);
      }
    };

    initApp();

    // Listeners
    const battSub = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      const newLevel = Math.round(batteryLevel * 100);
      if (
        Math.abs(newLevel - userRef.current.bat) > 2 ||
        newLevel < 20
      ) {
        actions.setUserBattery(newLevel);
        connectivityService.updateUser({ bat: newLevel });
      }
    });

    const appStateSub = AppState.addEventListener('change', async (nextAppState) => {
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
      actions.setUserPosition(loc.latitude, loc.longitude, userRef.current.head);
      connectivityService.updateUserPosition(
        loc.latitude,
        loc.longitude,
        userRef.current.head
      );
    });

    return () => {
      mounted = false;
      connSub();
      locSub();
      battSub.remove();
      appStateSub.remove();
      locationService.stopTracking();
      if (magSubscription.current) magSubscription.current.remove();
    };
  }, []);

  // Gestion magnétomètre
  useEffect(() => {
    if (ui.view === 'map' || ui.view === 'ops') {
      locationService.updateOptions({
        timeInterval: settings.gpsUpdateInterval,
        foregroundService: {
          notificationTitle: 'PRAXIS',
          notificationBody: '🛰️ Suivi GPS en arrière plan',
          notificationColor: '#000000',
        },
      });
      locationService.startTracking();

      if (magSubscription.current) magSubscription.current.remove();
      Magnetometer.setUpdateInterval(CONFIG.ORIENTATION_UPDATE_INTERVAL);
      magSubscription.current = Magnetometer.addListener((data) => {
        const { x, y } = data;
        let angle = Math.atan2(y, x) * (180 / Math.PI);
        angle = angle - 90;
        if (isLandscape) angle = angle + 90;
        if (angle < 0) angle = angle + 360;
        const heading = Math.floor(angle);
        actions.setUser({ head: heading });
        if (Math.abs(heading - lastSentHead.current) > 5) {
          lastSentHead.current = heading;
          connectivityService.updateUserPosition(
            userRef.current.lat,
            userRef.current.lng,
            heading
          );
        }
      });
    } else {
      if (!network.hostId) locationService.stopTracking();
      if (magSubscription.current) magSubscription.current.remove();
    }

    return () => {
      if (magSubscription.current) magSubscription.current.remove();
    };
  }, [ui.view, settings.gpsUpdateInterval, network.hostId, isLandscape]);

  // Gestion des événements de connectivité
  const handleConnectivityEvent = (event: any) => {
    switch (event.type) {
      case 'PEER_OPEN':
        actions.setUser({ id: event.id });
        if (userRef.current.role === OperatorRole.HOST) {
          actions.setHostId(event.id);
          showToast(`Session: ${event.id}`, 'success');
        }
        break;

      case 'PEERS_UPDATED':
        actions.setPeers(event.peers);
        break;

      case 'HOST_CONNECTED':
        actions.setHostId(event.hostId);
        showToast('Lien Hôte établi', 'success');
        break;

      case 'TOAST':
        showToast(event.msg, event.level as any);
        break;

      case 'DATA_RECEIVED':
        handleProtocolData(event.data, event.from);
        break;

      case 'DISCONNECTED':
        if (event.reason === 'KICKED') {
          Alert.alert('Fin de Mission', 'Vous avez été exclu de la session.');
          finishLogout();
        } else if (event.reason === 'NO_HOST') {
          showToast('Liaison Hôte Perdue...', 'warning');
        }
        break;

      case 'RECONNECTING':
        showToast(`Reconnexion réseau (${event.attempt})...`, 'warning');
        break;

      case 'NEW_HOST_PROMOTED':
        actions.setHostId(event.hostId);
        if (event.hostId === userRef.current.id) {
          actions.setUser({ role: OperatorRole.HOST });
          Alert.alert('Promotion', 'Vous êtes le nouveau Chef de Session.');
        }
        break;
    }
  };

  // Gestion des données protocole
  const handleProtocolData = (data: any, fromId: string) => {
    const senderName = network.peers[fromId]?.callsign || fromId.substring(0, 4);

    if (data.type === 'HELLO' && user.role === OperatorRole.HOST) {
      connectivityService.sendTo(fromId, {
        type: 'SYNC_PINGS',
        pings: ping.pings,
      });
      connectivityService.sendTo(fromId, {
        type: 'SYNC_LOGS',
        logs: logs.logs,
      });
    }

    if (data.type === 'PING') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      actions.addPing(data.ping);
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
    } else if (data.type === 'LOG_UPDATE' && Array.isArray(data.logs)) {
      const newLogs = data.logs;
      if (newLogs.length > logs.logs.length) {
        const latestLog = newLogs[newLogs.length - 1];
        if (latestLog.pax === 'HOSTILE') {
          const logBody = `${latestLog.lieu || 'Non spécifié'} - ${latestLog.action} / ${
            latestLog.remarques || 'RAS'
          }`;
          triggerTacticalNotification(`MAIN COURANTE - HOSTILE`, logBody);
        }
      }
      // Remplacer les logs
      newLogs.forEach((log: LogEntry) => {
        if (!logs.logs.find((l) => l.id === log.id)) {
          actions.addLog(log);
        }
      });
    } else if (
      (data.type === 'UPDATE_USER' || data.type === 'UPDATE') &&
      data.user
    ) {
      const u = data.user as UserData;
      const prevStatus = network.peers[u.id]?.status;
      const prevMsg = network.peers[u.id]?.lastMsg;

      actions.updatePeer(u.id, u);

      if (u.status === 'CONTACT' && prevStatus !== 'CONTACT') {
        showToast(`${u.callsign} : CONTACT !`, 'error');
        triggerTacticalNotification(
          `${u.callsign} - CONTACT`,
          `Position GPS: ${u.lat?.toFixed(5) || 'N/A'}`
        );
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
    } else if (data.type === 'SYNC_PINGS') {
      data.pings.forEach((p: PingData) => {
        if (!ping.pings.find((existing) => existing.id === p.id)) {
          actions.addPing(p);
        }
      });
    } else if (data.type === 'SYNC_LOGS') {
      data.logs.forEach((l: LogEntry) => {
        if (!logs.logs.find((existing) => existing.id === l.id)) {
          actions.addLog(l);
        }
      });
    } else if (data.type === 'PING_MOVE') {
      actions.movePing(data.id, data.lat, data.lng);
    } else if (data.type === 'PING_DELETE') {
      actions.deletePing(data.id);
    } else if (data.type === 'PING_UPDATE') {
      actions.updatePing(data.id, {
        msg: data.msg,
        details: data.details,
        image: data.image,
      });
    }
  };

  // Déconnexion
  const finishLogout = useCallback(() => {
    connectivityService.cleanup();
    locationService.stopTracking();
    if (magSubscription.current) {
      magSubscription.current.remove();
      magSubscription.current = null;
    }
    actions.resetAll();
  }, [actions]);

  // Rejoindre session
  const joinSession = async (id?: string) => {
    const finalId = id || network.hostId;
    if (!finalId) return;

    const role = OperatorRole.OPR;
    const now = Date.now();
    actions.setUser({
      role,
      paxColor: settings.userArrowColor,
      joinedAt: now,
    });

    try {
      await connectivityService.init(
        { ...user, role, paxColor: settings.userArrowColor, joinedAt: now },
        role,
        finalId
      );
      actions.setHostId(finalId);
      actions.setView('map');
    } catch (error) {
      console.error('Erreur connexion:', error);
      showToast('Erreur de connexion', 'error');
    }
  };

  // Créer session
  const createSession = async () => {
    const role = OperatorRole.HOST;
    const now = Date.now();
    actions.setUser({
      role,
      paxColor: settings.userArrowColor,
      joinedAt: now,
    });

    try {
      await connectivityService.init(
        { ...user, role, paxColor: settings.userArrowColor, joinedAt: now },
        role
      );
      actions.setView('map');
    } catch (error) {
      showToast('Erreur création session', 'error');
    }
  };

  // Logout
  const handleLogout = async () => {
    safeBroadcast({ type: 'CLIENT_LEAVING', id: user.id });
    setTimeout(finishLogout, 500);
  };

  // Navigation vers opérateur
  const handleOperatorActionNavigate = (targetId: string) => {
    actions.setNavTarget(targetId);
    actions.setNavMode('pedestrian');
    actions.setView('map');
    showToast('Ralliement activé');
    connectivityService.sendTo(targetId, {
      type: 'RALLY_REQ',
      sender: user.callsign,
    });
  };

  // Kick opérateur
  const handleOperatorActionKick = (targetId: string, banType: 'temp' | 'perm') => {
    connectivityService.kickUser(targetId);
    actions.removePeer(targetId);
    showToast('Opérateur Exclu');
  };

  // Envoi message rapide
  const handleSendQuickMessage = (msg: string) => {
    actions.setUserMessage(msg);
    connectivityService.updateUser({ lastMsg: msg });
    actions.toggleQuickMsgModal();
    actions.setFreeMsgInput('');
    showToast('Message transmis');
  };

  // Soumission ping
  const submitPing = async () => {
    if (!ping.tempPingLoc) return;

    const newPing: PingData = {
      id: Math.random().toString(36).substr(2, 9),
      lat: ping.tempPingLoc.lat,
      lng: ping.tempPingLoc.lng,
      msg:
        ping.pingMsgInput ||
        (ping.currentPingType === 'HOSTILE'
          ? 'ENNEMI'
          : ping.currentPingType === 'FRIEND'
          ? 'AMI'
          : 'OBS'),
      type: ping.currentPingType,
      sender: user.callsign,
      timestamp: Date.now(),
      details:
        ping.currentPingType === 'HOSTILE'
          ? ({} as HostileDetails)
          : undefined,
      image: ping.tempImage,
    };

    actions.addPing(newPing);
    await safeBroadcast({ type: 'PING', ping: newPing }, ping.currentPingType === 'HOSTILE');

    actions.setTempPingLoc(null);
    actions.setPingMsgInput('');
    actions.setTempImage(null);
    actions.togglePingForm();
  };

  // Déplacement ping
  const handlePingMove = (updatedPing: PingData) => {
    actions.movePing(updatedPing.id, updatedPing.lat, updatedPing.lng);
    safeBroadcast({
      type: 'PING_MOVE',
      id: updatedPing.id,
      lat: updatedPing.lat,
      lng: updatedPing.lng,
    });
  };

  // Édition ping
  const savePingEdit = () => {
    if (!ping.editingPing) return;
    const updatedPing = {
      ...ping.editingPing,
      msg: ping.pingMsgInput,
      image: ping.tempImage,
    };
    actions.updatePing(ping.editingPing.id, updatedPing);
    safeBroadcast({
      type: 'PING_UPDATE',
      id: ping.editingPing.id,
      msg: ping.pingMsgInput,
      image: ping.tempImage,
    });
    actions.setEditingPing(null);
    actions.setTempImage(null);
  };

  // Suppression ping
  const deletePing = () => {
    if (!ping.editingPing) return;
    actions.deletePing(ping.editingPing.id);
    safeBroadcast({ type: 'PING_DELETE', id: ping.editingPing.id });
    actions.setEditingPing(null);
    actions.setTempImage(null);
  };

  // Gestion logs
  const handleAddLog = (entry: LogEntry) => {
    actions.addLog(entry);
    safeBroadcast({ type: 'LOG_UPDATE', logs: [...logs.logs, entry] });
  };

  const handleUpdateLog = (updatedEntry: LogEntry) => {
    actions.updateLog(updatedEntry);
    const newLogs = logs.logs.map((l) =>
      l.id === updatedEntry.id ? updatedEntry : l
    );
    safeBroadcast({ type: 'LOG_UPDATE', logs: newLogs });
  };

  const handleDeleteLog = (id: string) => {
    actions.deleteLog(id);
    const newLogs = logs.logs.filter((l) => l.id !== id);
    safeBroadcast({ type: 'LOG_UPDATE', logs: newLogs });
  };

  // Scanner QR
  const handleScannerBarCodeScanned = ({ data }: any) => {
    actions.toggleScanner();
    setTimeout(() => joinSession(data), 500);
  };

  // Copier ID
  const copyToClipboard = async () => {
    await Clipboard.setStringAsync(network.hostId || user.id || '');
    showToast('ID Copié', 'success');
  };

  // Retour
  const handleBackPress = () => {
    if (ui.view === 'settings') {
      actions.goBack();
      return;
    }
    if (ui.view === 'ops' || ui.view === 'map') {
      Alert.alert('Déconnexion', 'Quitter la session ?', [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer', style: 'destructive', onPress: handleLogout },
      ]);
    } else {
      actions.setView('login');
    }
  };

  // Rendu header
  const renderHeader = () => {
    if (map.navTargetId && map.navInfo) {
      return (
        <View style={styles.headerContent}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <MaterialIcons name="navigation" size={24} color="#06b6d4" />
            <View>
              <Text style={{ color: '#06b6d4', fontWeight: 'bold', fontSize: 16 }}>
                RALLIEMENT
              </Text>
              <Text style={{ color: 'white', fontSize: 12 }}>
                {network.peers[map.navTargetId]?.callsign} - {map.navInfo.dist} -{' '}
                {map.navInfo.time}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 15, alignItems: 'center' }}>
            <TouchableOpacity onPress={() => actions.setNavMode('pedestrian')}>
              <MaterialIcons
                name="directions-walk"
                size={26}
                color={map.navMode === 'pedestrian' ? '#22c55e' : '#52525b'}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => actions.setNavMode('vehicle')}>
              <MaterialIcons
                name="directions-car"
                size={26}
                color={map.navMode === 'vehicle' ? '#22c55e' : '#52525b'}
              />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => actions.setNavTarget(null)}>
              <MaterialIcons name="close" size={28} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.headerContent}>
        <TouchableOpacity onPress={handleBackPress}>
          <MaterialIcons
            name="arrow-back"
            size={24}
            color={ui.nightOpsMode ? '#ef4444' : 'white'}
          />
        </TouchableOpacity>

        <Text style={[styles.headerTitle, ui.nightOpsMode && { color: '#ef4444' }]}>
          Praxis
        </Text>

        <View style={{ flexDirection: 'row', gap: 15 }}>
          <TouchableOpacity onPress={() => actions.toggleLogs()}>
            <MaterialIcons
              name="history-edu"
              size={24}
              color={ui.nightOpsMode ? '#ef4444' : 'white'}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => actions.toggleNightOps()}>
            <MaterialIcons
              name="nightlight-round"
              size={24}
              color={ui.nightOpsMode ? '#ef4444' : 'white'}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => actions.toggleSettings()}>
            <MaterialIcons
              name="settings"
              size={24}
              color={ui.nightOpsMode ? '#ef4444' : 'white'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              if (ui.view === 'map') actions.setView('ops');
              else actions.setView('map');
            }}
          >
            <MaterialIcons
              name={ui.view === 'map' ? 'list' : 'map'}
              size={24}
              color={ui.nightOpsMode ? '#ef4444' : 'white'}
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Rendu contenu principal
  const renderMainContent = () => {
    const isMapMode = ui.view === 'map';
    const isOpsMode = ui.view === 'ops';

    return (
      <View style={{ flex: 1 }}>
        <View style={styles.header}>
          <SafeAreaView>{renderHeader()}</SafeAreaView>
        </View>

        <View style={{ flex: 1, display: isOpsMode ? 'flex' : 'none' }}>
          <ScrollView contentContainerStyle={styles.grid}>
            <OperatorCard user={user} isMe style={{ width: '100%' }} isNightOps={ui.nightOpsMode} />
            {Object.values(network.peers)
              .filter((p) => p.id !== user.id)
              .map((p) => (
                <TouchableOpacity
                  key={p.id}
                  onLongPress={() => actions.setSelectedOperator(p.id)}
                  activeOpacity={0.8}
                  style={{ width: '100%' }}
                >
                  <OperatorCard user={p} me={user} style={{ width: '100%' }} isNightOps={ui.nightOpsMode} />
                </TouchableOpacity>
              ))}
          </ScrollView>
        </View>

        <View style={{ flex: 1, display: isMapMode ? 'flex' : 'none', position: 'relative' }}>
          <View style={{ flex: 1 }}>
            <TacticalMap
              me={user}
              peers={network.peers}
              pings={ping.pings}
              mapMode={map.mode}
              customMapUrl={settings.customMapUrl}
              showTrails={map.showTrails}
              showPings={map.showPings}
              isHost={user.role === OperatorRole.HOST}
              userArrowColor={settings.userArrowColor}
              pingMode={map.isPingMode}
              navTargetId={map.navTargetId}
              nightOpsMode={ui.nightOpsMode}
              initialCenter={map.center ? { ...map.center, zoom: map.zoom } : undefined}
              isLandscape={isLandscape}
              maxTrailsPerUser={settings.maxTrailsPerUser}
              onPing={(loc) => {
                actions.setTempPingLoc(loc);
                actions.togglePingMenu();
                actions.setTempImage(null);
              }}
              onPingMove={handlePingMove}
              onPingClick={(id) => {
                const p = ping.pings.find((ping) => ping.id === id);
                if (!p) return;
                actions.setEditingPing(p);
                actions.setPingMsgInput(p.msg);
                actions.setTempImage(p.image || null);
              }}
              onPingLongPress={(id) => {}}
              onNavStop={() => actions.setNavTarget(null)}
              onMapMoveEnd={(center, zoom) => {
                actions.setMapCenter(center);
                actions.setMapZoom(zoom);
              }}
            />

            <View style={styles.mapControls}>
              <TouchableOpacity
                onPress={() =>
                  actions.setMapMode(
                    map.mode === 'custom'
                      ? 'dark'
                      : map.mode === 'dark'
                      ? 'light'
                      : map.mode === 'light'
                      ? 'satellite'
                      : map.mode === 'satellite'
                      ? 'hybrid'
                      : settings.customMapUrl
                      ? 'custom'
                      : 'dark'
                  )
                }
                style={styles.mapBtn}
              >
                <MaterialIcons
                  name={
                    map.mode === 'dark'
                      ? 'dark-mode'
                      : map.mode === 'light'
                      ? 'light-mode'
                      : map.mode === 'hybrid'
                      ? 'layers'
                      : map.mode === 'custom'
                      ? 'map'
                      : 'satellite'
                  }
                  size={24}
                  color={ui.nightOpsMode ? '#ef4444' : '#d4d4d8'}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => actions.toggleTrails()} style={styles.mapBtn}>
                <MaterialIcons
                  name={map.showTrails ? 'visibility' : 'visibility-off'}
                  size={24}
                  color={ui.nightOpsMode ? '#ef4444' : '#d4d4d8'}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => actions.togglePings()} style={styles.mapBtn}>
                <MaterialIcons
                  name={map.showPings ? 'location-on' : 'location-off'}
                  size={24}
                  color={ui.nightOpsMode ? '#ef4444' : '#d4d4d8'}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => actions.togglePingMode()}
                style={[
                  styles.mapBtn,
                  map.isPingMode && { backgroundColor: '#dc2626', borderColor: '#f87171' },
                ]}
              >
                <MaterialIcons name="ads-click" size={24} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={[styles.footer, ui.nightOpsMode && { borderTopColor: '#7f1d1d' }]}>
          <View style={styles.statusRow}>
            {[OperatorStatus.PROGRESSION, OperatorStatus.CONTACT, OperatorStatus.CLEAR].map(
              (s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => {
                    actions.setUserStatus(s);
                    connectivityService.updateUser({
                      status: s,
                      paxColor: settings.userArrowColor,
                    });
                  }}
                  style={[
                    styles.statusBtn,
                    user.status === s && {
                      backgroundColor: STATUS_COLORS[s],
                      borderColor: 'white',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBtnText,
                      user.status === s && { color: 'white' },
                    ]}
                  >
                    {s}
                  </Text>
                </TouchableOpacity>
              )
            )}
            <TouchableOpacity
              onPress={() => actions.toggleQuickMsgModal()}
              style={[styles.statusBtn, { borderColor: '#06b6d4' }]}
            >
              <Text style={[styles.statusBtnText, { color: '#06b6d4' }]}>MSG</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => actions.toggleQRModal()}
              style={[styles.statusBtn, { borderColor: '#d4d4d8' }]}
            >
              <MaterialIcons name="qr-code-2" size={16} color="#d4d4d8" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  // Rendu contenu global
  const renderContent = () => {
    if (ui.view === 'oi') {
      return <ComposantOrdreInitial onClose={() => actions.setView('login')} />;
    } else if (ui.view === 'login') {
      return (
        <View style={styles.centerContainer}>
          <TacticalBackground />
          <TextInput
            style={styles.input}
            placeholder="TRIGRAMME"
            placeholderTextColor="#52525b"
            maxLength={6}
            value={user.callsign}
            onChangeText={(text) => actions.setUser({ callsign: text.toUpperCase() })}
            autoCapitalize="characters"
          />
          <View style={{ marginTop: 50, width: '100%', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => {
                if (user.callsign.length < 2) return;
                mmkvStorage.set(CONFIG.TRIGRAM_STORAGE_KEY, user.callsign.toUpperCase(), true);
                configService.update({ username: user.callsign.toUpperCase() });
                actions.setView('menu');
              }}
              style={[styles.strategicaBtn, { backgroundColor: 'rgba(0,0,0,0.5)', width: '100%' }]}
            >
              <Text style={styles.strategicaBtnText}>Praxis</Text>
            </TouchableOpacity>
          </View>
          <View style={{ marginTop: 20, width: '100%', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={() => actions.setView('oi')}
              style={[styles.strategicaBtn, { width: '100%' }]}
            >
              <Text style={styles.strategicaBtnText}>Stratégica</Text>
            </TouchableOpacity>
          </View>
          <UpdateNotifier />
          <PrivacyConsentModal onConsentGiven={() => {}} />
        </View>
      );
    } else if (ui.view === 'menu') {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.menuContainer}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
              <Text style={styles.sectionTitle}>Praxis</Text>
              <TouchableOpacity onPress={() => actions.toggleSettings()}>
                <MaterialIcons name="settings" size={24} color="white" />
              </TouchableOpacity>
            </View>
            {network.hostId ? (
              <>
                <TouchableOpacity
                  onPress={() => actions.setView('map')}
                  style={[styles.menuCard, { borderColor: '#22c55e' }]}
                >
                  <MaterialIcons name="map" size={40} color="#22c55e" />
                  <View style={{ marginLeft: 20 }}>
                    <Text style={styles.menuCardTitle}>RETOURNER SESSION</Text>
                    <Text style={styles.menuCardSubtitle}>{network.hostId}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() =>
                    Alert.alert('Déconnexion', 'Quitter ?', [
                      { text: 'Non' },
                      { text: 'Oui', onPress: handleLogout },
                    ])
                  }
                  style={[styles.menuCard, { borderColor: '#ef4444', marginTop: 20 }]}
                >
                  <MaterialIcons name="logout" size={40} color="#ef4444" />
                  <View style={{ marginLeft: 20 }}>
                    <Text style={[styles.menuCardTitle, { color: '#ef4444' }]}>QUITTER</Text>
                  </View>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity onPress={createSession} style={styles.menuCard}>
                  <MaterialIcons name="add-location-alt" size={40} color="#3b82f6" />
                  <View style={{ marginLeft: 20 }}>
                    <Text style={styles.menuCardTitle}>CRÉER SESSION</Text>
                    <Text style={styles.menuCardSubtitle}>Hôte</Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.divider} />
                <TextInput
                  style={styles.inputBox}
                  placeholder="ID GROUPE..."
                  placeholderTextColor="#52525b"
                  value={network.hostId}
                  onChangeText={(text) => actions.setHostId(text.toUpperCase())}
                  autoCapitalize="characters"
                />
                <TouchableOpacity onPress={() => joinSession()} style={styles.joinBtn}>
                  <Text style={styles.joinBtnText}>REJOINDRE</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    Camera.requestCameraPermissionsAsync().then(() =>
                      actions.toggleScanner()
                    );
                  }}
                  style={[styles.joinBtn, { marginTop: 10, backgroundColor: '#18181b', borderWidth: 1, borderColor: '#333' }]}
                >
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

  if (!isAppReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <ActivityIndicator size="large" color="#2563eb" style={{ marginTop: 50 }} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor="#050505" />
      {renderContent()}

      {/* Modales */}
      <Modal visible={ui.showSettings} animationType="slide" onRequestClose={() => actions.toggleSettings()}>
        <SettingsView
          onClose={() => actions.toggleSettings()}
          onUpdate={(s) => {
            actions.updateSettings(s);
            if (s.quickMessages) {
              actions.setQuickMessages(s.quickMessages);
            }
            actions.setUser({ paxColor: s.userArrowColor });
            connectivityService.updateUser({ paxColor: s.userArrowColor });
            if (s.gpsUpdateInterval !== settings.gpsUpdateInterval) {
              locationService.updateOptions({ timeInterval: s.gpsUpdateInterval });
            }
          }}
        />
      </Modal>

      <OperatorActionModal
        visible={!!ui.selectedOperatorId}
        targetOperator={network.peers[ui.selectedOperatorId || ''] || null}
        currentUserRole={user.role}
        onClose={() => actions.setSelectedOperator(null)}
        onKick={handleOperatorActionKick}
        onNavigate={handleOperatorActionNavigate}
      />

      <MainCouranteView
        visible={ui.showLogs}
        logs={logs.logs}
        role={user.role}
        onClose={() => actions.toggleLogs()}
        onAddLog={handleAddLog}
        onUpdateLog={handleUpdateLog}
        onDeleteLog={handleDeleteLog}
      />

      {/* Toast notification */}
      {ui.activeNotification && (
        <NotificationToast
          message={ui.activeNotification.msg}
          type={ui.activeNotification.type}
          isNightOps={ui.nightOpsMode}
          onDismiss={() => actions.dismissNotification()}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#050505',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    backgroundColor: '#050505',
  },
  header: {
    backgroundColor: '#050505',
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
  },
  input: {
    backgroundColor: 'rgba(24, 24, 27, 0.8)',
    color: 'white',
    padding: 16,
    borderRadius: 12,
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  strategicaBtn: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  strategicaBtnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  menuContainer: {
    flex: 1,
    padding: 20,
    backgroundColor: '#050505',
  },
  sectionTitle: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  menuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181b',
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  menuCardTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  menuCardSubtitle: {
    color: '#71717a',
    fontSize: 12,
  },
  divider: {
    height: 1,
    backgroundColor: '#27272a',
    marginVertical: 20,
  },
  inputBox: {
    backgroundColor: '#18181b',
    color: 'white',
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  joinBtn: {
    backgroundColor: '#3b82f6',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  joinBtnText: {
    color: 'white',
    fontWeight: 'bold',
  },
  grid: {
    padding: 16,
  },
  mapControls: {
    position: 'absolute',
    top: 16,
    right: 16,
    gap: 8,
  },
  mapBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(24, 24, 27, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  footer: {
    backgroundColor: '#050505',
    borderTopWidth: 1,
    borderTopColor: '#27272a',
    padding: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 8,
  },
  statusBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#18181b',
    alignItems: 'center',
  },
  statusBtnText: {
    color: '#71717a',
    fontWeight: 'bold',
    fontSize: 12,
  },
});

export default App;
