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
  PointAnnotation,
  ShapeSource,
  LineLayer,
  CircleLayer,
  FillLayer,
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
  isVisible: boolean;
}

// --- SOUS-COMPOSANTS ---

// 1. Marqueur Opérateur
interface OperatorMarkerProps {
  user: UserData;
  isMe?: boolean;
  color: string;
  nightOpsMode: boolean;
  mapHeading?: number;
}

// --- HELPER GEOMETRY ---
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

const calculateDestinationPoint = (lat: number, lng: number, distanceM: number, bearing: number): [number, number] => {
  const R = 6371e3; // Rayon Terre en mètres
  const angDist = distanceM / R;
  const radBearing = toRad(bearing);
  const phi1 = toRad(lat);
  const lam1 = toRad(lng);

  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(angDist) + Math.cos(phi1) * Math.sin(angDist) * Math.cos(radBearing));
  const lam2 = lam1 + Math.atan2(Math.sin(radBearing) * Math.sin(angDist) * Math.cos(phi1), Math.cos(angDist) - Math.sin(phi1) * Math.sin(phi2));

  return [toDeg(lam2), toDeg(phi2)]; // [lng, lat]
};

// 1. Marqueur Opérateur
interface OperatorMarkerProps {
  user: UserData;
  isMe?: boolean;
  color: string;
  nightOpsMode: boolean;
  mapHeading?: number;
}

const OperatorMarker = ({ user, isMe, color, nightOpsMode, mapHeading = 0 }: OperatorMarkerProps) => {
  // CORRECTION: User requested status colors even in Night Ops
  // Logic: Always use status color if not 'isMe' (unless me is CONTACT/HOSTILE which overrides?)
  // Standard logic: 'isMe' takes precedence for color (usually arrow color). 
  // EXCEPT if status is CONTACT, usually we want to see it.

  // Base status color (Blue/Green/Red/Orange)
  const baseStatusColor = STATUS_COLORS[user.status] || '#71717a';

  // In Night Ops, previously we forced red. Now we keep the color but maybe adjust brightness? 
  // User asked for "colors displayed". So we strictly use baseStatusColor.
  // Exception: If Night Ops needs specific red for everything else, we might want to respect that, 
  // but User specifically asked for blue/green/red status colors.

  let displayColor = isMe ? color : baseStatusColor;

  // OVERRIDE: If CONTACT, we want to pulse RED even if it is 'Me' (User feedback implies consistency)
  // Also 'CONTACT' overrides Night Ops uniform color.
  if (user.status === 'CONTACT') displayColor = STATUS_COLORS.CONTACT; // Red
  if (user.status === 'CLEAR') displayColor = STATUS_COLORS.CLEAR; // Blue

  // Handle Night Ops override ONLY if status is standard/progression? 
  // User said: "It is necessary that status colors be displayed... (blue, green, red)".
  // So we do NOT override with uniform red if status is significant.
  // If status is standard (BUSY/PROGRESSION), we might keep it or use night ops red?
  // Let's stick to baseStatusColor as requested.

  // However, for pure aesthetics in Night Ops, maybe we only force Red if NO status?
  // The current code forced red for everything.
  // We will trust `baseStatusColor`.

  const trigram = (user.callsign || 'UNK').substring(0, 3).toUpperCase();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Pulse animation logic
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
      {/* Circle ID - Member Icon */}
      <Animated.View style={[
        styles.circleId,
        {
          borderColor: displayColor,
          backgroundColor: isMe ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.6)',
          transform: [{ scale: pulseAnim }],
          zIndex: 2 // Ensure it is above/below correctly
        }
      ]}>
        <Text style={styles.circleText}>{trigram}</Text>
      </Animated.View>

      {/* Battery Warning */}
      {/* Issue fix: Ensure it doesn't hide the member icon. 
          Position is absolute bottom-right. zIndex higher to overlay on corner.
      */}
      {user.bat < 20 && (
        <View style={[styles.batteryWarning, { zIndex: 3 }]}>
          <MaterialIcons name="battery-alert" size={12} color="#ef4444" />
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

const TacticalCompass = ({ heading, isLandscape, onPress, mode, nightOpsMode }: TacticalCompassProps & { nightOpsMode: boolean }) => {
  // Correction: En mode Paysage, l'orientation est inversée de 180° selon le retour utilisateur - ANNULÉ: Le user signale que le Nord est le Sud. On retire l'inversion.
  const displayHeading = heading;

  const borderColor = nightOpsMode ? '#7f1d1d' : 'rgba(255,255,255,0.2)';
  const labelColor = nightOpsMode ? '#ef4444' : 'rgba(255,255,255,0.8)';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.compassContainer,
        isLandscape ? styles.compassLandscape : { top: 20 }
      ]}
    >
      <View style={styles.compassIndicator} />
      <View style={[
        styles.compassRose,
        {
          transform: [{
            rotate: mode === 'heading' ? `${-displayHeading}deg` : '0deg'
          }],
          borderColor: borderColor
        }
      ]}>
        <Text style={[styles.compassLabel, styles.compassN, nightOpsMode && { color: '#ef4444' }]}>N</Text>
        <Text style={[styles.compassLabel, styles.compassE, { color: labelColor }]}>E</Text>
        <Text style={[styles.compassLabel, styles.compassS, { color: labelColor }]}>S</Text>
        <Text style={[styles.compassLabel, styles.compassW, { color: labelColor }]}>O</Text>
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
  onLongPress?: () => void;
}

const PingMarker = ({ ping, nightOpsMode, onPress, onLongPress }: PingMarkerProps) => {

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
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.8}
      hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 48,
        minHeight: 48
      }}
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
  isVisible,
}: TacticalMapProps) => {
  const mapRef = useRef<MapView>(null);
  const cameraRef = useRef<Camera>(null);

  const [isMapReady, setIsMapReady] = useState(false);
  const [followUser, setFollowUser] = useState(true);
  const [trails, setTrails] = useState<Record<string, { coords: [number, number][], color: string }[]>>({});
  // Mode Boussole
  const [compassMode, setCompassMode] = useState<'north' | 'heading'>('heading');
  const [currentMapHeading, setCurrentMapHeading] = useState(0);

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



  // Suivi Caméra & Auto-Center
  useEffect(() => {
    // Si la map devient visible ou si followUser est réactivé
    if (isVisible && isMapReady && me.lat && me.lng) {
      if (followUser) {
        cameraRef.current?.setCamera({
          centerCoordinate: [me.lng, me.lat],
          animationDuration: 1000,
        });
      }
    }
  }, [isVisible, isMapReady, followUser, me.lat, me.lng]);

  // Réinitialiser le suivi quand on revient sur la vue
  useEffect(() => {
    if (isVisible && isMapReady) {
      setFollowUser(true);
      setCompassMode('heading'); // Optionnel : remettre le mode heading aussi ? ou garder dernier état ? Le user a dit "se centre", 'followUser' suffit.
    }
  }, [isVisible, isMapReady]);

  // Handle manual interaction to stop following
  const onRegionWillChange = (feature: any) => {
    // Si l'utilisateur touche la carte (gesture), on arrête le suivi automatique
    if (feature.properties?.isUserInteraction) {
      setFollowUser(false);
    }
  };

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

  // GeoJSON Cones (Vision)
  const conesGeoJSON = useMemo(() => {
    const features: any[] = [];

    // Helper pour générer un triangle de vision
    const addCone = (u: UserData) => {
      if (!u.lat || !u.lng) return;
      // Rayon de 50m, Angle 60° (head - 30 à head + 30)
      const center = [u.lng, u.lat];
      const head = u.head || 0;

      const p1 = calculateDestinationPoint(u.lat, u.lng, 60, head - 30);
      const p2 = calculateDestinationPoint(u.lat, u.lng, 60, head + 30);

      // Fermer le polygone : Centre -> P1 -> P2 -> Centre
      const coords = [[center, p1, p2, center]];

      // Couleur selon status
      let color = nightOpsMode ? '#ef4444' : STATUS_COLORS[u.status] || '#71717a';
      if (u.status === 'CLEAR' && !nightOpsMode) color = STATUS_COLORS.CLEAR;
      if (u.status === 'CONTACT' && !nightOpsMode) color = STATUS_COLORS.CONTACT;

      features.push({
        type: 'Feature',
        properties: {
          id: u.id,
          color: color,
          opacity: 0.4
        },
        geometry: { type: 'Polygon', coordinates: coords }
      });
    };

    if (me.lat && me.lng) addCone(me);
    Object.values(peers).forEach(p => addCone(p));

    return { type: 'FeatureCollection', features };
  }, [me, peers, nightOpsMode]);

  const mapHeading = compassMode === 'heading' ? (me.head || 0) : currentMapHeading;

  // Click throttling to prevent double events from hybrid approach
  const lastClickTime = useRef<number>(0);
  const handlePingClickWithThrottle = (id: string) => {
    const now = Date.now();
    if (now - lastClickTime.current < 500) return;
    lastClickTime.current = now;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPingClick(id);
  };

  // Handle Ping Drag with Micro-Move Detection
  const handlePingDragEnd = (payload: any, ping: PingData) => {
    const { geometry } = payload;
    if (geometry && geometry.coordinates) {
      const [lng, lat] = geometry.coordinates;

      const deltaLat = Math.abs(lat - ping.lat);
      const deltaLng = Math.abs(lng - ping.lng);

      // If movement is very small (< ~50m), consider it a sloppy click
      if (deltaLat < 0.0005 && deltaLng < 0.0005) {
        handlePingClickWithThrottle(ping.id);
        return;
      }

      onPingMove({ ...ping, lat, lng });
    }
  };

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
              'raster-opacity': nightOpsMode && mapMode !== 'dark' ? 0.6 : 1,
              'raster-brightness-min': nightOpsMode && mapMode !== 'dark' ? -0.2 : 0,
              'raster-saturation': nightOpsMode && mapMode !== 'dark' ? -0.4 : 0,
            },
          }],
        }}
        onPress={handleMapPress}
        onRegionWillChange={onRegionWillChange}
        onRegionDidChange={(e) => {
          if (e.properties?.heading !== undefined) {
            setCurrentMapHeading(e.properties.heading);
          }
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

        {/* --- NIGHT OPS OVERLAY (Red Filter for Dark/Light modes) --- */}
        {/* FIX: Keep ShapeSource always mounted when NightOps is active but vary opacity.
            Prevents crash when unmounting layer during map style transition. */}
        {nightOpsMode && (
          <ShapeSource
            id="nightOpsSource"
            shape={{
              type: 'FeatureCollection',
              features: [{
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'Polygon',
                  coordinates: [[
                    [-180, 90], [180, 90], [180, -90], [-180, -90], [-180, 90]
                  ]]
                }
              }]
            }}
          >
            <FillLayer
              id="nightOpsFill"
              style={{
                fillColor: '#ef4444',
                // Only show tint in Dark/Light modes, otherwise transparent (opacity 0)
                // This keeps the layer mounted during style switches, preventing native crash.
                fillOpacity: (mapMode === 'dark' || mapMode === 'light') ? 0.2 : 0,
              }}
            />
          </ShapeSource>
        )}
            }}
          />
        )}
        {/* Note: FillLayer requires a source. To make a global overlay, we need a source covering the world or viewport.
            Actually, it's easier to use a View overlay on top of MapView if we want it to cover everything, 
            BUT markers need to arguably be ON TOP or UNDER? 
            User said "Un filtre rouge s'applique si la carte est Dark/White".
            Usually this means the MAP is tinted. Markers might be tinted too or pop out.
            Status colors (Blue/Green/Red) MUST be visible (previous request). 
            If I put a View overlay over the MapView, it might wash out the markers or block interactions?
            PointerEvents="none" on View allows interaction.
            
            Alternative: A GeoJSON polygon covering the world?
            Easier: Use a specialized View inside the component, absolutely positioned, pointerEvents="none".
            Structure:
            <View container>
              <MapView>...</MapView>
              <Overlay />
              <Compass />
            </View>
            
            Let's do that instead of a Layer inside MapView, as it's more robust effectively acting as a screen filter.
            Wait, if I put it outside MapView, it will tint markers too.
            If I put it layer inside MapView, it tints the base map but Markers (React Native Views) are above Layers?
            In MapLibre RN, PointAnnotations are views on top. Layers are GL.
            So a FillLayer is BELOW PointAnnotations.
            This is perfect! It tints the map tiles but keeps markers bright and colored as requested.
            
            We need a source for the FillLayer.
            Let's create a simple world bounding box GeoJSON.
        */}

        {/* --- CONES DE VISION (GeoJSON Native) --- */}
        <ShapeSource id="conesSource" shape={conesGeoJSON}>
          <FillLayer
            id="conesFill"
            style={{
              fillColor: ['get', 'color'],
              fillOpacity: 0.4,
              fillOutlineColor: ['get', 'color']
            }}
          />
          <LineLayer
            id="conesOutline"
            style={{
              lineColor: ['get', 'color'],
              lineWidth: 1,
              lineOpacity: 0.8
            }}
          />
        </ShapeSource>

        {/* --- MARKERS OPÉRATEURS --- */}
        {!!me.lat && !!me.lng && (
          <PointAnnotation
            key={`me-${me.id}-${me.status}-${Math.round((me.head || 0) / 5)}-${Math.round(mapHeading / 5)}-${nightOpsMode}-${mapMode}`}
            id={`me-${me.id}`}
            coordinate={[me.lng, me.lat]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <OperatorMarker user={me} isMe color={userArrowColor} nightOpsMode={nightOpsMode} mapHeading={mapHeading} />
          </PointAnnotation>
        )}

        {Object.values(peers).map((peer) =>
          !!peer.lat && !!peer.lng && (
            <PointAnnotation
              key={`peer-${peer.id}-${peer.status}-${Math.round((peer.head || 0) / 5)}-${Math.round(mapHeading / 5)}-${nightOpsMode}-${mapMode}`}
              id={`peer-${peer.id}`}
              coordinate={[peer.lng, peer.lat]}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <OperatorMarker user={peer} color={userArrowColor} nightOpsMode={nightOpsMode} mapHeading={mapHeading} />
            </PointAnnotation>
          )
        )}

        {/* --- PINGS (Draggable) --- */}
        {showPings && pings.map((ping) => (
          <PointAnnotation
            key={`${ping.id}-${mapMode}-${nightOpsMode}-${ping.timestamp}`}
            id={ping.id}
            coordinate={[ping.lng, ping.lat]}
            draggable
            onDragEnd={(e) => handlePingDragEnd(e, ping)}
            onSelected={() => handlePingClickWithThrottle(ping.id)}
          >
            <PingMarker
              ping={ping}
              nightOpsMode={nightOpsMode}
              onPress={() => handlePingClickWithThrottle(ping.id)}
            />
          </PointAnnotation>
        ))}
      </MapView>

      <TacticalCompass
        heading={me.head || 0}
        isLandscape={isLandscape}
        mode={compassMode}
        nightOpsMode={nightOpsMode}
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



      {navTargetId && peers[navTargetId] && (
        <View style={[styles.navIndicator, nightOpsMode && { backgroundColor: '#7f1d1d' }]}>
          <MaterialIcons name="navigation" size={20} color={nightOpsMode ? "#ef4444" : "#06b6d4"} />
          <Text style={[styles.navText, nightOpsMode && { color: '#ef4444' }]}>
            CIBLE: {peers[navTargetId].callsign}
          </Text>
          <TouchableOpacity onPress={onNavStop} style={styles.navStopBtn}>
            <MaterialIcons name="close" size={20} color={nightOpsMode ? "#ef4444" : "#ef4444"} />
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
    // top: 20, // Managed dynamically
    left: 20,
    width: 60,
    height: 60,
    zIndex: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compassLandscape: {
    bottom: 140, // Positionné au-dessus de la barre de progression/statut
    left: 20,
  },
  compassRose: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)', // Overridden safely by style prop if not using StyleSheet.flatten? Actually style matches order.
    // Ideally we pass dynamic styles.
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
