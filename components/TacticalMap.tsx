/**
 * TacticalMap - Composant Carte avec MapLibre
 * Remplace la carte WebView par une solution native haute performance
 * * Avantages:
 * - Rendu GPU natif (60fps)
 * - Support offline MBTiles
 * - Gestures fluides
 * - Consommation mémoire optimisée
 */

import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Alert,
  useWindowDimensions,
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
  Images,
} from '@maplibre/maplibre-react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  UserData,
  PingData,
  OperatorRole,
  PingType,
} from '../types';
import { STATUS_COLORS } from '../constants';

// Styles de tuiles pour différents modes
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

// Composant Marker personnalisé pour les opérateurs
const OperatorMarker: React.FC<{
  user: UserData;
  isMe?: boolean;
  color: string;
  nightOpsMode: boolean;
}> = ({ user, isMe, color, nightOpsMode }) => {
  const statusColor = nightOpsMode ? '#ef4444' : STATUS_COLORS[user.status] || '#71717a';
  const displayColor = isMe ? color : statusColor;

  return (
    <View style={styles.markerContainer}>
      <View
        style={[
          styles.operatorMarker,
          { borderColor: displayColor },
          isMe && styles.operatorMarkerMe,
        ]}
      >
        <View
          style={[
            styles.operatorArrow,
            {
              borderBottomColor: displayColor, // CORRECTION: Applique la couleur au triangle (border)
              transform: [{ rotate: `${user.head || 0}deg` }], // Sécurité si head est undefined
            },
          ]}
        />
        <Text style={styles.operatorLabel} numberOfLines={1}>
          {user.callsign}
        </Text>
        {user.bat < 20 && (
          <View style={styles.batteryWarning}>
            <MaterialIcons name="battery-alert" size={12} color="#ef4444" />
          </View>
        )}
      </View>
      {isMe && (
        <View style={[styles.accuracyRing, { borderColor: displayColor }]} />
      )}
    </View>
  );
};

// Composant Marker pour les pings
const PingMarker: React.FC<{
  ping: PingData;
  nightOpsMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
}> = ({ ping, nightOpsMode, onPress, onLongPress }) => {
  const getPingColors = () => {
    if (nightOpsMode) {
      return { bg: '#000', border: '#ef4444', text: '#ef4444' };
    }
    switch (ping.type) {
      case 'HOSTILE':
        return { bg: '#450a0a', border: '#ef4444', text: '#ef4444' };
      case 'FRIEND':
        return { bg: '#052e16', border: '#22c55e', text: '#22c55e' };
      case 'INTEL':
        return { bg: '#422006', border: '#eab308', text: '#eab308' };
      default:
        return { bg: '#18181b', border: '#3b82f6', text: '#3b82f6' };
    }
  };

  const colors = getPingColors();
  const iconName =
    ping.type === 'HOSTILE'
      ? 'warning'
      : ping.type === 'FRIEND'
      ? 'shield'
      : 'visibility';

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.8}
      style={styles.pingMarkerContainer}
    >
      <View
        style={[
          styles.pingMarker,
          { backgroundColor: colors.bg, borderColor: colors.border },
        ]}
      >
        <MaterialIcons name={iconName} size={20} color={colors.text} />
        {ping.image && (
          <View style={styles.imageIndicator}>
            <MaterialIcons name="photo-camera" size={10} color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.pingLabelContainer}>
        <Text style={[styles.pingLabel, { color: colors.text }]} numberOfLines={1}>
          {ping.msg}
        </Text>
        <Text style={styles.pingSender}>{ping.sender}</Text>
      </View>
    </TouchableOpacity>
  );
};

// Composant principal TacticalMap
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
  const { width, height } = useWindowDimensions();

  const [isMapReady, setIsMapReady] = useState(false);
  const [followUser, setFollowUser] = useState(true);

  // Historique des positions pour les trails
  const [trails, setTrails] = useState<Record<string, [number, number][]>>({});

  // URL des tuiles
  const tileUrl = useMemo(() => {
    if (mapMode === 'custom' && customMapUrl) {
      return customMapUrl;
    }
    return TILE_URLS[mapMode] || TILE_URLS.satellite;
  }, [mapMode, customMapUrl]);

  // Mise à jour des trails
  useEffect(() => {
    if (!showTrails) return;

    setTrails((prev) => {
      const newTrails = { ...prev };

      // Ajouter position de l'utilisateur
      if (me.lat && me.lng) {
        if (!newTrails[me.id]) newTrails[me.id] = [];
        newTrails[me.id].push([me.lng, me.lat]);
        if (newTrails[me.id].length > maxTrailsPerUser) {
          newTrails[me.id].shift();
        }
      }

      // Ajouter positions des peers
      Object.values(peers).forEach((peer) => {
        if (peer.lat && peer.lng) {
          if (!newTrails[peer.id]) newTrails[peer.id] = [];
          newTrails[peer.id].push([peer.lng, peer.lat]);
          if (newTrails[peer.id].length > maxTrailsPerUser) {
            newTrails[peer.id].shift();
          }
        }
      });

      return newTrails;
    });
  }, [me.lat, me.lng, peers, showTrails, maxTrailsPerUser]);

  // Gestion du tap sur la carte (mode ping)
  const handleMapPress = useCallback(
    (event: any) => {
      if (!pingMode) return;

      const { geometry } = event;
      if (geometry?.coordinates) {
        const [lng, lat] = geometry.coordinates;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPing({ lat, lng });
      }
    },
    [pingMode, onPing]
  );

  // Suivi de la cible de navigation
  useEffect(() => {
    if (navTargetId && peers[navTargetId]) {
      const target = peers[navTargetId];
      cameraRef.current?.flyTo([target.lng, target.lat], 1000);
    }
  }, [navTargetId, peers]);

  // Centrer sur l'utilisateur au démarrage
  useEffect(() => {
    if (isMapReady && me.lat && me.lng && followUser) {
      cameraRef.current?.flyTo([me.lng, me.lat], 500);
    }
  }, [isMapReady, me.lat, me.lng, followUser]);

  // Gestion du mouvement de la carte
  const handleRegionChange = useCallback(
    (region: any) => {
      if (region?.geometry?.coordinates) {
        const [lng, lat] = region.geometry.coordinates;
        onMapMoveEnd({ lat, lng }, region.properties?.zoom || 15);
      }
    },
    [onMapMoveEnd]
  );

  // Géométrie des trails pour LineLayer
  const trailsGeoJSON = useMemo(() => {
    const features = Object.entries(trails)
      .filter(([_, coords]) => coords.length > 1)
      .map(([userId, coords]) => ({
        type: 'Feature' as const,
        properties: {
          userId,
          color: userId === me.id ? userArrowColor : STATUS_COLORS[peers[userId]?.status] || '#71717a',
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: coords,
        },
      }));

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [trails, me.id, userArrowColor, peers]);

  // Géométrie des pings
  const pingsGeoJSON = useMemo(() => {
    const features = pings.map((ping) => ({
      type: 'Feature' as const,
      properties: {
        id: ping.id,
        type: ping.type,
        msg: ping.msg,
        sender: ping.sender,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [ping.lng, ping.lat],
      },
    }));

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [pings]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={{
          version: 8,
          sources: {
            'raster-tiles': {
              type: 'raster',
              tiles: [tileUrl],
              tileSize: 256,
              attribution: '© OpenStreetMap contributors',
            },
          },
          layers: [
            {
              id: 'raster-tiles',
              type: 'raster',
              source: 'raster-tiles',
              paint: {
                'raster-opacity': nightOpsMode ? 0.5 : 1,
                'raster-brightness-min': nightOpsMode ? -0.3 : 0,
                'raster-saturation': nightOpsMode ? -0.5 : 0,
              },
            },
          ],
        }}
        onPress={handleMapPress}
        onRegionDidChange={handleRegionChange}
        onMapLoadingFinished={() => setIsMapReady(true)}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={true}
        compassViewPosition={3}
        compassViewMargins={{ x: 20, y: isLandscape ? 150 : 100 }}
      >
        <Camera
          ref={cameraRef}
          centerCoordinate={
            initialCenter
              ? [initialCenter.lng, initialCenter.lat]
              : me.lat && me.lng
              ? [me.lng, me.lat]
              : [2.3522, 48.8566] // Paris par défaut
          }
          zoomLevel={initialCenter?.zoom || 15}
          followUserLocation={followUser && !navTargetId}
          followUserMode="normal"
          animationDuration={500}
        />

        {/* Location utilisateur native */}
        <UserLocation
          visible={true}
          showsUserHeadingIndicator={true}
          minDisplacement={5}
        />

        {/* Trails */}
        {showTrails && (
          <ShapeSource id="trailsSource" shape={trailsGeoJSON}>
            <LineLayer
              id="trailsLayer"
              style={{
                lineWidth: 3,
                lineColor: ['get', 'color'],
                lineOpacity: 0.7,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* Pings */}
        {showPings && (
          <ShapeSource id="pingsSource" shape={pingsGeoJSON}>
            <CircleLayer
              id="pingsCircle"
              style={{
                circleRadius: 20,
                circleColor: [
                  'match',
                  ['get', 'type'],
                  'HOSTILE',
                  '#ef4444',
                  'FRIEND',
                  '#22c55e',
                  'INTEL',
                  '#eab308',
                  '#3b82f6',
                ],
                circleOpacity: 0.3,
                circleStrokeWidth: 2,
                circleStrokeColor: [
                  'match',
                  ['get', 'type'],
                  'HOSTILE',
                  '#ef4444',
                  'FRIEND',
                  '#22c55e',
                  'INTEL',
                  '#eab308',
                  '#3b82f6',
                ],
              }}
            />
            <SymbolLayer
              id="pingsLabel"
              style={{
                textField: ['get', 'msg'],
                textSize: 12,
                textColor: nightOpsMode ? '#ef4444' : '#fff',
                textHaloColor: '#000',
                textHaloWidth: 2,
                textAnchor: 'top',
                textOffset: [0, 1.5],
              }}
            />
          </ShapeSource>
        )}

        {/* Markers opérateurs */}
        {/* CORRECTION: Utilisation de !! pour forcer un booléen et éviter le rendu de "0" */}
        {!!me.lat && !!me.lng && (
          <MarkerView coordinate={[me.lng, me.lat]} anchor={{ x: 0.5, y: 0.5 }}>
            <OperatorMarker user={me} isMe color={userArrowColor} nightOpsMode={nightOpsMode} />
          </MarkerView>
        )}

        {Object.values(peers).map(
          (peer) =>
            // CORRECTION: Utilisation de !! ici aussi
            !!peer.lat &&
            !!peer.lng && (
              <MarkerView
                key={peer.id}
                coordinate={[peer.lng, peer.lat]}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <OperatorMarker user={peer} color={userArrowColor} nightOpsMode={nightOpsMode} />
              </MarkerView>
            )
        )}

        {/* Markers pings interactifs */}
        {showPings &&
          pings.map((ping) => (
            <MarkerView
              key={ping.id}
              coordinate={[ping.lng, ping.lat]}
              anchor={{ x: 0.5, y: 1 }}
            >
              <PingMarker
                ping={ping}
                nightOpsMode={nightOpsMode}
                onPress={() => onPingClick(ping.id)}
                onLongPress={() => onPingLongPress(ping.id)}
              />
            </MarkerView>
          ))}
      </MapView>

      {/* Indicateur mode ping */}
      {pingMode && (
        <View style={styles.pingModeIndicator}>
          <MaterialIcons name="touch-app" size={24} color="#ef4444" />
          <Text style={styles.pingModeText}>MODE PING - Touchez la carte</Text>
        </View>
      )}

      {/* Bouton centrer sur moi */}
      {!followUser && (
        <TouchableOpacity
          style={styles.recenterButton}
          onPress={() => {
            setFollowUser(true);
            if (me.lat && me.lng) {
              cameraRef.current?.flyTo([me.lng, me.lat], 500);
            }
          }}
        >
          <MaterialIcons name="my-location" size={24} color="#3b82f6" />
        </TouchableOpacity>
      )}

      {/* Indicateur navigation */}
      {navTargetId && peers[navTargetId] && (
        <View style={styles.navIndicator}>
          <MaterialIcons name="navigation" size={20} color="#06b6d4" />
          <Text style={styles.navText}>
            Ralliement: {peers[navTargetId].callsign}
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
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
  map: {
    flex: 1,
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  operatorMarker: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  operatorMarkerMe: {
    width: 52,
    height: 52,
    borderRadius: 26,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 10,
  },
  operatorArrow: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 16,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'white', // CORRECTION: inherit n'existe pas en RN
    position: 'absolute',
    top: 4,
  },
  operatorLabel: {
    position: 'absolute',
    bottom: -20,
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    maxWidth: 80,
  },
  accuracyRing: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
    borderStyle: 'dashed',
    opacity: 0.5,
  },
  batteryWarning: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#000',
    borderRadius: 10,
    padding: 2,
  },
  pingMarkerContainer: {
    alignItems: 'center',
  },
  pingMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 5,
  },
  imageIndicator: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    padding: 2,
  },
  pingLabelContainer: {
    marginTop: 4,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pingLabel: {
    fontSize: 11,
    fontWeight: 'bold',
    maxWidth: 100,
  },
  pingSender: {
    fontSize: 9,
    color: '#71717a',
  },
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
  },
  pingModeText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 5,
  },
  navIndicator: {
    position: 'absolute',
    top: 80,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 182, 212, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 10,
  },
  navText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
    flex: 1,
  },
  navStopBtn: {
    padding: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 12,
  },
});

export default TacticalMap;
