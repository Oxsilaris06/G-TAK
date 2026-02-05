/**
 * TacticalMap - Composant Carte avec MapLibre
 * Restauration du design original (Cône de vision, Boussole tactique, Trails pointillés)
 */

import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  useWindowDimensions,
  Platform,
  Animated,
} from 'react-native';
import MapLibreGL, {
  MapView,
  Camera,
  UserLocation,
  MarkerView,
  PointAnnotation,
  ShapeSource,
  LineLayer,
  CircleLayer,
} from '@maplibre/maplibre-react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import {
  UserData,
  PingData,
} from '../types';
import { STATUS_COLORS } from '../constants';

// Styles de tuiles
const TILE_URLS: Record<string, string> = {
  dark: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  hybrid: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
};

// Props du composant
interface TacticalMapProps {
  me: UserData;
  peers: Record<string, UserData>;
  pings: PingData[];
  mapMode: 'dark' | 'light' | 'satellite' | 'hybrid' | 'custom';
  customMapUrl?: string;
  showTrails: boolean;
  showPings: boolean;
  isHost: boolean;
  userArrowColor: string;
  pingMode: boolean;
  navTargetId: string | null;
  nightOpsMode: boolean;
  initialCenter?: { lat: number; lng: number; zoom: number };
  isLandscape: boolean;
  maxTrailsPerUser: number;
  onPing: (loc: { lat: number; lng: number }) => void;
  onPingMove: (ping: PingData) => void;
  onPingClick: (id: string) => void;
  onPingLongPress: (id: string) => void;
  onNavStop: () => void;
  onMapMoveEnd: (center: { lat: number; lng: number }, zoom: number) => void;
}

// --- SOUS-COMPOSANTS ---

// 1. Marqueur Opérateur
interface OperatorMarkerProps {
  user: UserData;
  isMe?: boolean;
  color: string;
  nightOpsMode: boolean;
}

const OperatorMarker = ({ user, isMe, color, nightOpsMode }: OperatorMarkerProps) => {
  const statusColor = nightOpsMode ? '#ef4444' : STATUS_COLORS[user.status] || '#71717a';
  let displayColor = isMe ? color : statusColor;

  if (user.status === 'CLEAR' && !nightOpsMode) displayColor = STATUS_COLORS.CLEAR;
  if (user.status === 'CONTACT' && !nightOpsMode) displayColor = STATUS_COLORS.CONTACT;

  const rotation = user.head || 0;
  const trigram = (user.callsign || 'UNK').substring(0, 3).toUpperCase();

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (user.status === 'CONTACT') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [user.status]);

  return (
    <View style={[styles.markerRoot, isMe && { zIndex: 100 }]}>
      <View style={[styles.coneContainer, { transform: [{ rotate: `${rotation}deg` }] }]}>
        <Svg height="80" width="80" viewBox="0 0 100 100">
          <Path
            d="M50 50 L10 0 A60 60 0 0 1 90 0 Z"
            fill={displayColor}
            fillOpacity="0.3"
            stroke={displayColor}
            strokeWidth="1"
            strokeOpacity="0.5"
          />
        </Svg>
      </View>

      <Animated.View style={[
        styles.circleId,
        {
          borderColor: displayColor,
          backgroundColor: isMe ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.6)',
          transform: [{ scale: pulseAnim }]
        }
      ]}>
        <Text style={styles.circleText}>{trigram}</Text>
      </Animated.View>

      {user.bat < 20 && (
        <View style={styles.batteryWarning}>
          <MaterialIcons name="battery-alert" size={10} color="#ef4444" />
        </View>
      )}
    </View>
  );
};

// 2. Boussole Tactique Overlay
interface TacticalCompassProps {
  heading: number;
  isLandscape: boolean;
  onPress: () => void;
  mode: 'north' | 'heading';
}

const TacticalCompass = ({ heading, isLandscape, onPress, mode }: TacticalCompassProps) => {
  // Correction: En mode Paysage, l'orientation est inversée de 180° selon le retour utilisateur
  const displayHeading = isLandscape ? heading + 180 : heading;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.compassContainer, isLandscape ? styles.compassLandscape : null]}
    >
      <View style={styles.compassIndicator} />
      <View style={[
        styles.compassRose,
        {
          transform: [{
            rotate: mode === 'heading' ? `${-displayHeading}deg` : '0deg'
          }]
        }
      ]}>
        <Text style={[styles.compassLabel, styles.compassN]}>N</Text>
        <Text style={[styles.compassLabel, styles.compassE]}>E</Text>
        <Text style={[styles.compassLabel, styles.compassS]}>S</Text>
        <Text style={[styles.compassLabel, styles.compassW]}>O</Text>
      </View>
      {mode === 'heading' && (
        <View style={{ position: 'absolute', bottom: -15, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 4, borderRadius: 4 }}>
          <Text style={{ color: '#ef4444', fontSize: 8, fontWeight: 'bold' }}>CAP</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

// 3. Marker Ping
interface PingMarkerProps {
  ping: PingData;
  nightOpsMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

const PingMarker = ({ ping, nightOpsMode, onPress, onLongPress }: PingMarkerProps) => {
  const lastTap = useRef<number>(0);

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      onPress(); // Double tap reconnu = Edition
    }
    lastTap.current = now;
  };

  const getPingColors = () => {
    switch (ping.type) {
      case 'HOSTILE': return { bg: '#450a0a', border: '#ef4444', text: '#ef4444' };
      case 'FRIEND': return { bg: '#052e16', border: '#22c55e', text: '#22c55e' };
      case 'INTEL': return { bg: '#422006', border: '#eab308', text: '#eab308' };
      default: return { bg: '#18181b', border: '#3b82f6', text: '#3b82f6' };
    }
  };

  const colors = getPingColors();
  const iconName = ping.type === 'HOSTILE' ? 'warning' : ping.type === 'FRIEND' ? 'shield' : 'visibility';

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={onLongPress}
      activeOpacity={0.6}
      style={styles.pingMarkerContainer}
    >
      {/* Taille réduite pour précision (28x28) */}
      <View style={[styles.pingMarker, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <MaterialIcons name={iconName} size={16} color={colors.text} />
      </View>
      <View style={styles.pingLabelContainer}>
        <Text style={[styles.pingLabel, { color: colors.text }]} numberOfLines={1}>
          {ping.msg}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

// --- COMPOSANT PRINCIPAL ---

const TacticalMap = ({
  me,
  peers,
  pings,
  mapMode,
  customMapUrl,
  showTrails,
  showPings,
  isHost,
  userArrowColor,
  pingMode,
  navTargetId,
  nightOpsMode,
  initialCenter,
  isLandscape,
  maxTrailsPerUser,
  onPing,
  onPingMove,
  onPingClick,
  onPingLongPress,
  onNavStop,
  onMapMoveEnd,
}: TacticalMapProps) => {
  const mapRef = useRef<MapView>(null);
  const cameraRef = useRef<Camera>(null);

  const [isMapReady, setIsMapReady] = useState(false);
  const [followUser, setFollowUser] = useState(true);
  const [trails, setTrails] = useState<Record<string, { coords: [number, number][], color: string }[]>>({});
  // Mode Boussole
  const [compassMode, setCompassMode] = useState<'north' | 'heading'>('heading');

  // Effet pour la boussole magnétique
  useEffect(() => {
    if (compassMode === 'heading' && me.head !== undefined) {
      cameraRef.current?.setCamera({
        heading: me.head,
        animationDuration: 200
      });
    }
  }, [compassMode, me.head]);

  // URL des tuiles
  const tileUrl = useMemo(() => {
    if (mapMode === 'custom' && customMapUrl) return customMapUrl;
    return TILE_URLS[mapMode] || TILE_URLS.satellite;
  }, [mapMode, customMapUrl]);

  // Gestion des trails
  useEffect(() => {
    if (!showTrails) return;

    const updateTrails = (id: string, lat: number, lng: number, status: string) => {
      setTrails((prev) => {
        const newTrails = { ...prev };
        if (!newTrails[id]) newTrails[id] = [];

        const currentStatusColor = id === me.id ? userArrowColor : STATUS_COLORS[status] || '#71717a';
        let lastSegment = newTrails[id][newTrails[id].length - 1];

        if (!lastSegment || lastSegment.color !== currentStatusColor) {
          lastSegment = { coords: [], color: currentStatusColor };
          newTrails[id].push(lastSegment);
        }

        const lastPoint = lastSegment.coords[lastSegment.coords.length - 1];
        if (!lastPoint || Math.abs(lastPoint[0] - lng) > 0.00005 || Math.abs(lastPoint[1] - lat) > 0.00005) {
          lastSegment.coords.push([lng, lat]);
        }

        if (newTrails[id].length > 50) newTrails[id].shift();
        return newTrails;
      });
    };

    if (me.lat && me.lng) updateTrails(me.id, me.lat, me.lng, me.status);
    Object.values(peers).forEach(p => {
      if (p.lat && p.lng) updateTrails(p.id, p.lat, p.lng, p.status);
    });
  }, [me.lat, me.lng, me.status, peers, showTrails, userArrowColor]);

  // Interactions Carte
  const handleMapPress = useCallback((event: any) => {
    if (!pingMode) return;
    const { geometry } = event;
    if (geometry?.coordinates) {
      const [lng, lat] = geometry.coordinates;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onPing({ lat, lng });
    }
  }, [pingMode, onPing]);

  // Handle Ping Drag
  const handlePingDragEnd = (payload: any, ping: PingData) => {
    const { geometry } = payload;
    if (geometry && geometry.coordinates) {
      const [lng, lat] = geometry.coordinates;
      onPingMove({ ...ping, lat, lng });
    }
  };

  // Suivi Caméra
  useEffect(() => {
    if (!isMapReady) return;

    if (navTargetId && peers[navTargetId]) {
      const target = peers[navTargetId];
      cameraRef.current?.flyTo([target.lng, target.lat], 1000);
      setFollowUser(false);
      return;
    }

    if (followUser && me.lat && me.lng) {
      cameraRef.current?.setCamera({
        centerCoordinate: [me.lng, me.lat],
        animationDuration: 1000,
      });
    }
  }, [isMapReady, navTargetId, peers, followUser, me.lat, me.lng]);

  // Initial Center
  useEffect(() => {
    if (isMapReady && initialCenter) {
      cameraRef.current?.setCamera({
        centerCoordinate: [initialCenter.lng, initialCenter.lat],
        zoomLevel: initialCenter.zoom,
        animationDuration: 0
      });
    }
  }, [isMapReady, initialCenter]);

  // GeoJSON Trails
  const trailsGeoJSON = useMemo(() => {
    const features: any[] = [];
    Object.entries(trails).forEach(([userId, segments]) => {
      segments.forEach(segment => {
        if (segment.coords.length > 1) {
          features.push({
            type: 'Feature',
            properties: { userId, color: segment.color },
            geometry: { type: 'LineString', coordinates: segment.coords },
          });
        }
      });
    });
    return { type: 'FeatureCollection', features };
  }, [trails]);

  // GeoJSON Pings (for circles)
  const pingsGeoJSON = useMemo(() => {
    const features = pings.map((ping) => ({
      type: 'Feature',
      properties: {
        id: ping.id,
        type: ping.type,
      },
      geometry: { type: 'Point', coordinates: [ping.lng, ping.lat] },
    }));
    return { type: 'FeatureCollection', features };
  }, [pings]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={{
          version: 8,
          sources: {
            'raster-tiles': { type: 'raster', tiles: [tileUrl], tileSize: 256 },
          },
          layers: [{
            id: 'raster-tiles',
            type: 'raster',
            source: 'raster-tiles',
            paint: {
              'raster-opacity': nightOpsMode ? 0.6 : 1,
              'raster-brightness-min': nightOpsMode ? -0.2 : 0,
              'raster-saturation': nightOpsMode ? -0.4 : 0,
            },
          }],
        }}
        onPress={handleMapPress}
        onRegionDidChange={(e) => {
          if (e.geometry?.coordinates) {
            onMapMoveEnd({ lat: e.geometry.coordinates[1], lng: e.geometry.coordinates[0] }, e.properties?.zoom || 15);
          }
        }}
        onMapLoadingFinished={() => setIsMapReady(true)}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: initialCenter ? [initialCenter.lng, initialCenter.lat] : [2.35, 48.85],
            zoomLevel: initialCenter?.zoom || 15
          }}
          animationDuration={1000}
        />

        {/* --- TRAILS --- */}
        {showTrails && (
          <ShapeSource id="trailsSource" key={`trails-${mapMode}`} shape={trailsGeoJSON}>
            <LineLayer
              id="trailsLayer"
              style={{
                lineWidth: 2,
                lineColor: ['get', 'color'],
                lineOpacity: 0.7,
                lineDasharray: [2, 2],
                lineCap: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* --- PINGS (Background Circles - Only when masked) --- */}
        {!showPings && (
          <ShapeSource id="pingsSource" key={`pings-${mapMode}`} shape={pingsGeoJSON}>
            <CircleLayer
              id="pingsCircle"
              style={{
                circleRadius: 5,
                circleColor: [
                  'match', ['get', 'type'],
                  'HOSTILE', '#ef4444',
                  'FRIEND', '#22c55e',
                  'INTEL', '#eab308',
                  '#3b82f6',
                ],
                circleOpacity: 0.2,
                circleStrokeWidth: 1,
                circleStrokeColor: [
                  'match', ['get', 'type'],
                  'HOSTILE', '#ef4444',
                  'FRIEND', '#22c55e',
                  'INTEL', '#eab308',
                  '#3b82f6',
                ],
              }}
            />
          </ShapeSource>
        )}

        {/* --- MARKERS OPÉRATEURS --- */}
        {!!me.lat && !!me.lng && (
          <MarkerView coordinate={[me.lng, me.lat]} anchor={{ x: 0.5, y: 0.5 }}>
            <OperatorMarker user={me} isMe color={userArrowColor} nightOpsMode={nightOpsMode} />
          </MarkerView>
        )}

        {Object.values(peers).map((peer) =>
          !!peer.lat && !!peer.lng && (
            <MarkerView key={peer.id} coordinate={[peer.lng, peer.lat]} anchor={{ x: 0.5, y: 0.5 }}>
              <OperatorMarker user={peer} color={userArrowColor} nightOpsMode={nightOpsMode} />
            </MarkerView>
          )
        )}

        {/* --- PINGS (Draggable) --- */}
        {showPings && pings.map((ping) => (
          <PointAnnotation
            key={`${ping.id}-${mapMode}`}
            id={ping.id}
            coordinate={[ping.lng, ping.lat]}
            draggable
            onDragEnd={(e) => handlePingDragEnd(e, ping)}
          >
            <PingMarker
              ping={ping}
              nightOpsMode={nightOpsMode}
              onPress={() => onPingClick(ping.id)}
              onLongPress={() => { }} // Handled by draggable
            />
          </PointAnnotation>
        ))}
      </MapView>

      <TacticalCompass
        heading={me.head || 0}
        isLandscape={isLandscape}
        mode={compassMode}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setCompassMode(prev => prev === 'north' ? 'heading' : 'north');
          if (compassMode === 'heading') {
            cameraRef.current?.setCamera({
              heading: 0,
              animationDuration: 500
            });
          }
        }}
      />

      {pingMode && (
        <View style={styles.pingModeIndicator}>
          <MaterialIcons name="touch-app" size={24} color="#ef4444" />
          <Text style={styles.pingModeText}>MODE PING ACTIF</Text>
        </View>
      )}

      {!followUser && !navTargetId && (
        <TouchableOpacity
          style={[styles.recenterButton, isLandscape && styles.recenterButtonLand]}
          onPress={() => { setFollowUser(true); setCompassMode('north'); }}
        >
          <MaterialIcons name="my-location" size={24} color="#3b82f6" />
        </TouchableOpacity>
      )}

      {navTargetId && peers[navTargetId] && (
        <View style={styles.navIndicator}>
          <MaterialIcons name="navigation" size={20} color="#06b6d4" />
          <Text style={styles.navText}>
            CIBLE: {peers[navTargetId].callsign}
          </Text>
          <TouchableOpacity onPress={onNavStop} style={styles.navStopBtn}>
            <MaterialIcons name="close" size={20} color="#ef4444" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  map: { flex: 1 },

  // Marker Opérateur
  markerRoot: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coneContainer: {
    position: 'absolute',
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleId: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  circleText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 2,
  },
  batteryWarning: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 6,
    padding: 1,
  },
  heartbeat: {
    borderColor: '#ef4444',
  },

  // Ping Marker
  pingMarkerContainer: { alignItems: 'center' },
  pingMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#18181b',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 5,
  },
  pingLabelContainer: {
    marginTop: 4,
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  pingLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#fff',
  },

  // Boussole
  compassContainer: {
    position: 'absolute',
    top: 20,
    left: 20,
    width: 60,
    height: 60,
    zIndex: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compassLandscape: {
    top: 'auto',
    bottom: 100, // Juste au dessus de la barre de statut (PROGRESSION etc)
    left: 20,
  },
  compassRose: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compassIndicator: {
    position: 'absolute',
    top: -4,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#ef4444',
    zIndex: 91,
  },
  compassLabel: {
    position: 'absolute',
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontWeight: 'bold',
  },
  compassN: { top: 4, color: '#ef4444' },
  compassS: { bottom: 4 },
  compassE: { right: 6 },
  compassW: { left: 6 },

  // UI Elements
  pingModeIndicator: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
    elevation: 5,
  },
  pingModeText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },

  recenterButton: {
    position: 'absolute',
    bottom: 120,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(24, 24, 27, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#3b82f6',
    elevation: 5,
  },
  recenterButtonLand: { bottom: 40, right: 100 },

  navIndicator: {
    position: 'absolute',
    top: 90,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 182, 212, 0.9)',
    padding: 12,
    borderRadius: 12,
    gap: 10,
    elevation: 5,
  },
  navText: { color: '#fff', fontWeight: 'bold', flex: 1 },
  navStopBtn: { padding: 4, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 8 },
});

export default TacticalMap;
