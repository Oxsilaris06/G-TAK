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
} from 'react-native';
import MapLibreGL, {
  MapView,
  Camera,
  UserLocation,
  MarkerView,
  ShapeSource,
  LineLayer,
  CircleLayer,
  SymbolLayer,
} from '@maplibre/maplibre-react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Svg, { Path, G } from 'react-native-svg';
import {
  UserData,
  PingData,
} from '../types';
import { STATUS_COLORS } from '../constants';

// Styles de tuiles
const TILE_URLS = {
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

// 1. Marqueur Opérateur Style Original (Cône + Cercle + Trigramme)
const OperatorMarker: React.FC<{
  user: UserData;
  isMe?: boolean;
  color: string;
  nightOpsMode: boolean;
}> = ({ user, isMe, color, nightOpsMode }) => {
  const statusColor = nightOpsMode ? '#ef4444' : STATUS_COLORS[user.status] || '#71717a';
  const displayColor = isMe ? color : statusColor;
  
  // Le cône tourne selon le heading
  const rotation = user.head || 0;
  
  // Trigramme (3 premières lettres)
  const trigram = (user.callsign || 'UNK').substring(0, 3).toUpperCase();

  return (
    <View style={[styles.markerRoot, isMe && { zIndex: 100 }]}>
      {/* Cône de vision rotatif */}
      <View style={[styles.coneContainer, { transform: [{ rotate: `${rotation}deg` }] }]}>
        <Svg height="80" width="80" viewBox="0 0 100 100">
           {/* Forme du cône originale: M50 50 L10 0 A60 60 0 0 1 90 0 Z */}
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

      {/* Cercle ID fixe (ne tourne pas) */}
      <View style={[
        styles.circleId, 
        { 
          borderColor: displayColor,
          backgroundColor: isMe ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.6)' 
        },
        user.status === 'CONTACT' && styles.heartbeat
      ]}>
        <Text style={styles.circleText}>{trigram}</Text>
      </View>
      
      {/* Indicateur batterie faible */}
      {user.bat < 20 && (
         <View style={styles.batteryWarning}>
           <MaterialIcons name="battery-alert" size={10} color="#ef4444" />
         </View>
      )}
    </View>
  );
};

// 2. Boussole Tactique Overlay
const TacticalCompass: React.FC<{ heading: number; isLandscape: boolean }> = ({ heading, isLandscape }) => {
  return (
    <View style={[styles.compassContainer, isLandscape ? styles.compassLandscape : null]}>
      {/* Indicateur fixe (triangle rouge) */}
      <View style={styles.compassIndicator} />
      
      {/* Rose des vents rotative */}
      <View style={[styles.compassRose, { transform: [{ rotate: `${-heading}deg` }] }]}>
        <Text style={[styles.compassLabel, styles.compassN]}>N</Text>
        <Text style={[styles.compassLabel, styles.compassE]}>E</Text>
        <Text style={[styles.compassLabel, styles.compassS]}>S</Text>
        <Text style={[styles.compassLabel, styles.compassW]}>O</Text>
      </View>
    </View>
  );
};

// 3. Marker Ping (Inchangé mais propre)
const PingMarker: React.FC<{
  ping: PingData;
  nightOpsMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
}> = ({ ping, nightOpsMode, onPress, onLongPress }) => {
  const getPingColors = () => {
    if (nightOpsMode) return { bg: '#000', border: '#ef4444', text: '#ef4444' };
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
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.8}
      style={styles.pingMarkerContainer}
    >
      <View style={[styles.pingMarker, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <MaterialIcons name={iconName} size={20} color={colors.text} />
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

const TacticalMap: React.FC<TacticalMapProps> = ({
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
}) => {
  const mapRef = useRef<MapView>(null);
  const cameraRef = useRef<Camera>(null);

  const [isMapReady, setIsMapReady] = useState(false);
  const [followUser, setFollowUser] = useState(true);
  const [trails, setTrails] = useState<Record<string, [number, number][]>>({});

  // URL des tuiles
  const tileUrl = useMemo(() => {
    if (mapMode === 'custom' && customMapUrl) return customMapUrl;
    return TILE_URLS[mapMode] || TILE_URLS.satellite;
  }, [mapMode, customMapUrl]);

  // Gestion des trails
  useEffect(() => {
    if (!showTrails) return;
    setTrails((prev) => {
      const newTrails = { ...prev };
      // Helper pour ajouter point
      const addPoint = (id: string, lat: number, lng: number) => {
        if (!newTrails[id]) newTrails[id] = [];
        const last = newTrails[id][newTrails[id].length - 1];
        // Filtre distance min (approx 5m)
        if (!last || Math.abs(last[0] - lng) > 0.00005 || Math.abs(last[1] - lat) > 0.00005) {
             newTrails[id].push([lng, lat]);
             if (newTrails[id].length > maxTrailsPerUser) newTrails[id].shift();
        }
      };

      if (me.lat && me.lng) addPoint(me.id, me.lat, me.lng);
      Object.values(peers).forEach(p => {
        if (p.lat && p.lng) addPoint(p.id, p.lat, p.lng);
      });
      return newTrails;
    });
  }, [me.lat, me.lng, peers, showTrails, maxTrailsPerUser]);

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

  // Suivi Caméra
  useEffect(() => {
    if (!isMapReady) return;
    
    // Mode Navigation
    if (navTargetId && peers[navTargetId]) {
      const target = peers[navTargetId];
      cameraRef.current?.flyTo([target.lng, target.lat], 1000);
      setFollowUser(false);
      return;
    }

    // Mode Suivi Utilisateur
    if (followUser && me.lat && me.lng) {
      // On utilise flyTo ou setCamera pour centrer sans changer le zoom violemment
      // Note: On ne force pas le heading ici pour laisser l'utilisateur tourner la carte s'il veut
      cameraRef.current?.setCamera({
        centerCoordinate: [me.lng, me.lat],
        animationDuration: 1000,
      });
    }
  }, [isMapReady, navTargetId, peers, followUser, me.lat, me.lng]);

  // GeoJSON Trails
  const trailsGeoJSON = useMemo(() => {
    const features = Object.entries(trails)
      .filter(([_, coords]) => coords.length > 1)
      .map(([userId, coords]) => ({
        type: 'Feature' as const,
        properties: {
          userId,
          color: userId === me.id ? userArrowColor : STATUS_COLORS[peers[userId]?.status] || '#71717a',
        },
        geometry: { type: 'LineString' as const, coordinates: coords },
      }));
    return { type: 'FeatureCollection' as const, features };
  }, [trails, me.id, userArrowColor, peers]);

  // GeoJSON Pings
  const pingsGeoJSON = useMemo(() => {
    const features = pings.map((ping) => ({
      type: 'Feature' as const,
      properties: {
        id: ping.id,
        type: ping.type,
      },
      geometry: { type: 'Point' as const, coordinates: [ping.lng, ping.lat] },
    }));
    return { type: 'FeatureCollection' as const, features };
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
        compassEnabled={false} // On utilise notre boussole custom
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
             centerCoordinate: initialCenter ? [initialCenter.lng, initialCenter.lat] : [2.35, 48.85],
             zoomLevel: initialCenter?.zoom || 15
          }}
          animationDuration={1000}
        />

        {/* --- TRAILS (POINTILLÉS) --- */}
        {showTrails && (
          <ShapeSource id="trailsSource" shape={trailsGeoJSON}>
            <LineLayer
              id="trailsLayer"
              style={{
                lineWidth: 2,
                lineColor: ['get', 'color'],
                lineOpacity: 0.7,
                lineDasharray: [2, 2], // Restauration des pointillés
                lineCap: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* --- PINGS (CERCLES SOUS-JACENTS) --- */}
        {showPings && (
          <ShapeSource id="pingsSource" shape={pingsGeoJSON}>
            <CircleLayer
              id="pingsCircle"
              style={{
                circleRadius: 20,
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

        {/* --- MARKERS OPÉRATEURS (Native Views) --- */}
        {/* Note: On utilise MarkerView pour avoir des vues React complètes */}
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

        {/* --- MARKERS PINGS (Interactifs) --- */}
        {showPings && pings.map((ping) => (
          <MarkerView key={ping.id} coordinate={[ping.lng, ping.lat]} anchor={{ x: 0.5, y: 1 }}>
            <PingMarker
              ping={ping}
              nightOpsMode={nightOpsMode}
              onPress={() => onPingClick(ping.id)}
              onLongPress={() => onPingLongPress(ping.id)}
            />
          </MarkerView>
        ))}
      </MapView>

      {/* --- OVERLAYS UI --- */}

      {/* Boussole Custom */}
      {/* On passe le heading utilisateur pour l'orientation temps réel */}
      <TacticalCompass heading={me.head || 0} isLandscape={isLandscape} />

      {/* Mode Ping */}
      {pingMode && (
        <View style={styles.pingModeIndicator}>
          <MaterialIcons name="touch-app" size={24} color="#ef4444" />
          <Text style={styles.pingModeText}>MODE PING ACTIF</Text>
        </View>
      )}

      {/* Bouton Recenter */}
      {!followUser && !navTargetId && (
        <TouchableOpacity
          style={[styles.recenterButton, isLandscape && styles.recenterButtonLand]}
          onPress={() => setFollowUser(true)}
        >
          <MaterialIcons name="my-location" size={24} color="#3b82f6" />
        </TouchableOpacity>
      )}

      {/* Nav Indicator */}
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
    width: 40,
    height: 40,
    borderRadius: 20,
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
    bottom: 20,
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
