import React, { useEffect, useRef, useMemo, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { UserData, PingData } from '../types';
import { MaterialIcons } from '@expo/vector-icons';

// Configuration de MapLibre
MapLibreGL.setAccessToken(null);

interface TacticalMapProps {
  me: UserData;
  peers: Record<string, UserData>;
  pings: PingData[];
  mapMode: 'dark' | 'light' | 'satellite' | 'custom';
  customMapUrl?: string;
  showTrails: boolean;
  showPings: boolean;
  isHost: boolean;
  userArrowColor: string;
  navTargetId?: string | null;
  pingMode?: boolean; 
  nightOpsMode?: boolean;
  initialCenter?: {lat: number, lng: number, zoom: number};
  
  // Props de compatibilité
  isLandscape?: boolean;
  maxTrailsPerUser?: number;

  onPing: (loc: { lat: number; lng: number }) => void;
  onPingMove: (ping: PingData) => void;
  onPingClick: (id: string) => void; 
  onPingLongPress: (id: string) => void;
  onNavStop: () => void;
  onMapMoveEnd?: (center: {lat: number, lng: number}, zoom: number) => void;
}

// --- STYLES RASTER (FIABLES SANS TOKEN) ---
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    'raster-tiles': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256, attribution: 'Esri'
    }
  },
  layers: [{ id: 'simple-tiles', type: 'raster', source: 'raster-tiles', minzoom: 0, maxzoom: 22 }]
};

const DARK_STYLE = {
  version: 8,
  sources: {
    'raster-tiles': {
      type: 'raster',
      tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
      tileSize: 256, attribution: 'CartoDB'
    }
  },
  layers: [{ id: 'simple-tiles', type: 'raster', source: 'raster-tiles', minzoom: 0, maxzoom: 22 }]
};

const LIGHT_STYLE = {
  version: 8,
  sources: {
    'raster-tiles': {
      type: 'raster',
      tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
      tileSize: 256, attribution: 'CartoDB'
    }
  },
  layers: [{ id: 'simple-tiles', type: 'raster', source: 'raster-tiles', minzoom: 0, maxzoom: 22 }]
};

const TacticalMap: React.FC<TacticalMapProps> = ({
  me, peers, pings, mapMode, customMapUrl, showTrails, showPings, isHost, userArrowColor, navTargetId, pingMode, nightOpsMode, initialCenter,
  isLandscape, 
  maxTrailsPerUser = 50,
  onPing, onPingMove, onPingClick, onPingLongPress, onNavStop, onMapMoveEnd
}) => {
  const cameraRef = useRef<MapLibreGL.Camera>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [trails, setTrails] = useState<Record<string, number[][]>>({});
  const [userTrackingMode, setUserTrackingMode] = useState<any>(MapLibreGL.UserTrackingMode.Follow);
  const [mapHeading, setMapHeading] = useState(0);

  // --- GESTION CAMÉRA ---
  useEffect(() => {
    if (!isMapReady || !cameraRef.current) return;

    if (navTargetId && me.location) {
        let targetLoc = null;
        const targetPing = pings.find(p => p.id === navTargetId);
        if (targetPing) targetLoc = targetPing.location;
        else {
            const targetPeer = peers[navTargetId];
            if (targetPeer) targetLoc = targetPeer.location;
        }

        if (targetLoc) {
            const minLng = Math.min(me.location.lng, targetLoc.lng);
            const minLat = Math.min(me.location.lat, targetLoc.lat);
            const maxLng = Math.max(me.location.lng, targetLoc.lng);
            const maxLat = Math.max(me.location.lat, targetLoc.lat);

            setUserTrackingMode(MapLibreGL.UserTrackingMode.None);
            cameraRef.current.fitBounds(
                [maxLng, maxLat], [minLng, minLat],
                50, 1000
            );
        }
    } else if (!navTargetId && me.location) {
        // Retour au suivi utilisateur uniquement si on était en navigation
        if (userTrackingMode === MapLibreGL.UserTrackingMode.None) {
            setUserTrackingMode(MapLibreGL.UserTrackingMode.Follow);
            cameraRef.current.setCamera({
                centerCoordinate: [me.location.lng, me.location.lat],
                zoomLevel: 15,
                animationDuration: 1000
            });
        }
    }
  }, [navTargetId, isMapReady]);

  useEffect(() => {
      if (!isMapReady || !cameraRef.current || !initialCenter) return;
      cameraRef.current.setCamera({
          centerCoordinate: [initialCenter.lng, initialCenter.lat],
          zoomLevel: initialCenter.zoom,
          animationDuration: 500
      });
  }, [initialCenter, isMapReady]);

  // --- TRACES ---
  useEffect(() => {
    if (!showTrails) {
        setTrails({});
        return;
    }
    setTrails(prev => {
        const newTrails = { ...prev };
        Object.values(peers).forEach(peer => {
            if (peer.location && peer.location.lat && peer.location.lng) {
                if (!newTrails[peer.id]) newTrails[peer.id] = [];
                const currentPos = [peer.location.lng, peer.location.lat];
                const lastPos = newTrails[peer.id][newTrails[peer.id].length - 1];
                if (!lastPos || (Math.abs(lastPos[0] - currentPos[0]) > 0.0001 || Math.abs(lastPos[1] - currentPos[1]) > 0.0001)) {
                    newTrails[peer.id] = [...newTrails[peer.id], currentPos].slice(-maxTrailsPerUser);
                }
            }
        });
        return newTrails;
    });
  }, [peers, showTrails, maxTrailsPerUser]);

  const toggleCompass = () => {
    if (userTrackingMode === MapLibreGL.UserTrackingMode.FollowWithHeading) {
        setUserTrackingMode(MapLibreGL.UserTrackingMode.Follow);
        cameraRef.current?.setCamera({ heading: 0, animationDuration: 500 });
        setMapHeading(0); 
    } else {
        setUserTrackingMode(MapLibreGL.UserTrackingMode.FollowWithHeading);
    }
  };

  const trailsSource = useMemo(() => {
    if (!showTrails) return { type: 'FeatureCollection', features: [] };
    const features = Object.entries(trails).map(([id, coordinates]) => {
        if (coordinates.length < 2) return null;
        return {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: coordinates },
            properties: { id }
        };
    }).filter(f => f !== null);
    return { type: 'FeatureCollection', features };
  }, [trails, showTrails]);

  const navLineSource = useMemo(() => {
    if (!navTargetId) return { type: 'FeatureCollection', features: [] };
    let targetLoc = null;
    const targetPing = pings.find(p => p.id === navTargetId);
    if (targetPing) targetLoc = targetPing.location;
    else {
        const targetPeer = peers[navTargetId];
        if (targetPeer) targetLoc = targetPeer.location;
    }
    if (targetLoc && me.location) {
        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[me.location.lng, me.location.lat], [targetLoc.lng, targetLoc.lat]] },
                properties: {}
            }]
        };
    }
    return { type: 'FeatureCollection', features: [] };
  }, [navTargetId, pings, peers, me.location]);

  const currentStyleJSON = useMemo(() => {
    if (mapMode === 'satellite') return JSON.stringify(SATELLITE_STYLE);
    if (mapMode === 'light') return JSON.stringify(LIGHT_STYLE);
    return JSON.stringify(DARK_STYLE);
  }, [mapMode]);

  const handlePress = (e: any) => {
    if (!isMapReady) return;
    const { geometry } = e;
    if (geometry && geometry.coordinates) {
      onPing({ lng: geometry.coordinates[0], lat: geometry.coordinates[1] });
    }
  };

  const handleLongPress = (e: any) => {
    if (!isMapReady) return;
    const { geometry } = e;
    if (geometry && geometry.coordinates) {
        onPing({ lng: geometry.coordinates[0], lat: geometry.coordinates[1] });
    }
  };

  // Helper pour les couleurs RGBA
  const getTeamColorRGBA = (team: string, alpha: number) => {
      if (team === 'RED') return `rgba(239, 68, 68, ${alpha})`;
      if (team === 'BLUE') return `rgba(59, 130, 246, ${alpha})`;
      return `rgba(16, 185, 129, ${alpha})`; // Green
  };
  
  const getTeamColorHex = (team: string) => {
      if (team === 'RED') return '#ef4444';
      if (team === 'BLUE') return '#3b82f6';
      return '#10b981';
  };

  return (
    <View style={styles.container}>
      <MapLibreGL.MapView
        style={styles.map}
        styleJSON={currentStyleJSON}
        logoEnabled={false}
        attributionEnabled={false}
        rotateEnabled={true}
        compassEnabled={false}
        onPress={handlePress}
        onLongPress={handleLongPress}
        onDidFinishLoadingMap={() => setIsMapReady(true)}
        onRegionIsChanging={(e) => {
            if (e.properties && typeof e.properties.heading === 'number') setMapHeading(e.properties.heading);
        }}
        onRegionDidChange={(e) => {
            if (e.properties && typeof e.properties.heading === 'number') setMapHeading(e.properties.heading);
            if (onMapMoveEnd && e.geometry && e.properties) {
                onMapMoveEnd({ lng: e.geometry.coordinates[0], lat: e.geometry.coordinates[1] }, e.properties.zoomLevel);
            }
        }}
      >
        <MapLibreGL.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: initialCenter ? [initialCenter.lng, initialCenter.lat] : (me.location ? [me.location.lng, me.location.lat] : [0, 0]),
            zoomLevel: initialCenter ? initialCenter.zoom : 15,
          }}
          followUserLocation={!navTargetId && !!me.location}
          followUserMode={userTrackingMode}
        />

        <MapLibreGL.UserLocation visible={true} animated={true} showsUserHeadingIndicator={true} renderMode="normal" />

        {showTrails && (
             <MapLibreGL.ShapeSource id="trailsSource" shape={trailsSource as any}>
                <MapLibreGL.LineLayer id="trailsLine" style={{ lineColor: '#00FFFF', lineWidth: 1, lineOpacity: 0.5 }} />
            </MapLibreGL.ShapeSource>
        )}

        {navTargetId && (
            <MapLibreGL.ShapeSource id="navLineSource" shape={navLineSource as any}>
                <MapLibreGL.LineLayer id="navLine" style={{ lineColor: '#FFD700', lineWidth: 3, lineDasharray: [2, 2], lineOpacity: 0.8 }} />
            </MapLibreGL.ShapeSource>
        )}

        {/* --- MEMBRES D'ÉQUIPE (PEERS) via PointAnnotation pour contrôle total --- */}
        {Object.values(peers)
            .filter(peer => peer.location && peer.location.lng !== undefined && peer.location.lat !== undefined)
            .map(peer => {
                const trigram = (peer.username || 'UNK').substring(0, 3).toUpperCase();
                const teamColorBg = getTeamColorRGBA(peer.team || 'NEUTRAL', 0.5); // Semi-transparent
                const teamColor = getTeamColorHex(peer.team || 'NEUTRAL');
                const heading = peer.orientation || 0;

                return (
                    <MapLibreGL.PointAnnotation
                        key={`peer-${peer.id}`}
                        id={`peer-${peer.id}`}
                        coordinate={[peer.location.lng, peer.location.lat]}
                        anchor={{ x: 0.5, y: 0.5 }}
                        selected={false}
                    >
                        {/* Conteneur global du membre */}
                        <View style={{ alignItems: 'center', justifyContent: 'center', width: 100, height: 100 }}>
                            {/* Cône de vision (Rotation indépendante) */}
                            <View style={{
                                position: 'absolute',
                                transform: [{ rotate: `${heading}deg` }],
                                top: 0, left: 0, right: 0, bottom: 0,
                                alignItems: 'center', justifyContent: 'center'
                            }}>
                                {/* Flèche décalée vers le haut pour simuler le cône */}
                                <MaterialIcons name="navigation" size={40} color={teamColor} style={{ marginBottom: 40, opacity: 0.8 }} />
                            </View>

                            {/* Cercle central avec Trigramme (Fixe, pas de rotation) */}
                            <View style={{
                                width: 34, height: 34,
                                borderRadius: 17,
                                backgroundColor: teamColorBg,
                                borderColor: 'white', borderWidth: 2,
                                alignItems: 'center', justifyContent: 'center',
                                zIndex: 10
                            }}>
                                <Text style={{ color: 'white', fontSize: 10, fontWeight: '900' }}>{trigram}</Text>
                            </View>

                            {/* Nom sous le cercle */}
                            <View style={{ position: 'absolute', bottom: 20, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, paddingHorizontal: 4 }}>
                                <Text style={{ color: 'white', fontSize: 10 }}>{peer.username}</Text>
                            </View>
                        </View>
                    </MapLibreGL.PointAnnotation>
                );
            })
        }

        {/* --- PINGS (Objets Tactiques) --- */}
        {showPings && pings.map((ping) => {
            if (!ping.location || ping.location.lng === undefined) return null;
            return (
            <MapLibreGL.PointAnnotation
                key={`ping-${ping.id}`}
                id={ping.id}
                coordinate={[ping.location.lng, ping.location.lat]}
                draggable={true}
                anchor={{ x: 0.5, y: 0.5 }}
                onSelected={() => onPingClick(ping.id)}
                onDragEnd={(payload: any) => {
                    const { geometry } = payload;
                    if (geometry) onPingMove({ ...ping, location: { lng: geometry.coordinates[0], lat: geometry.coordinates[1] } });
                }}
            >
                {/* Z-Index élevé pour les pings */}
                <View style={[styles.pingContainer, { zIndex: 100 }]}>
                    <View style={[styles.pingMarker, { backgroundColor: ping.color || '#F00' }]}>
                       <View style={styles.pingCenter} />
                    </View>
                    <View style={styles.pingLabelContainer}>
                        <Text style={styles.pingLabel}>{ping.type.substring(0, 4).toUpperCase()}</Text>
                    </View>
                </View>
                {/* Callout natif pour long press */}
                <MapLibreGL.Callout title={ping.msg || ping.type} />
            </MapLibreGL.PointAnnotation>
        )})}

      </MapLibreGL.MapView>

      <TouchableOpacity style={styles.compassBtn} onPress={toggleCompass} activeOpacity={0.7}>
          <MaterialIcons 
            name="explore" 
            size={36} 
            color={userTrackingMode === MapLibreGL.UserTrackingMode.FollowWithHeading ? "#FFD700" : "white"} 
            style={{ transform: [{ rotate: `${-mapHeading}deg` }] }}
          />
      </TouchableOpacity>

      {navTargetId && (
          <View style={styles.navControls}>
              <TouchableOpacity style={styles.stopNavBtn} onPress={onNavStop}>
                  <MaterialIcons name="navigation" size={20} color="#000" />
                  <Text style={styles.stopNavText}>ARRÊT NAV</Text>
                  <MaterialIcons name="close" size={20} color="#000" />
              </TouchableOpacity>
          </View>
      )}

      {nightOpsMode && <View style={styles.nightOpsOverlay} pointerEvents="none" />}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  map: { flex: 1 },
  nightOpsOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255, 0, 0, 0.15)', zIndex: 999 },
  pingContainer: { alignItems: 'center', justifyContent: 'center', width: 60, height: 60 },
  pingMarker: {
    width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'white', opacity: 0.9, elevation: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 2,
  },
  pingCenter: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'white' },
  pingLabelContainer: { marginTop: 2, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  pingLabel: { color: 'white', fontSize: 10, fontWeight: 'bold' },
  compassBtn: { position: 'absolute', top: 50, right: 16, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', zIndex: 100, elevation: 4 },
  navControls: { position: 'absolute', top: 50, alignSelf: 'center', zIndex: 100 },
  stopNavBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFD700', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, elevation: 5, gap: 8 },
  stopNavText: { color: '#000', fontWeight: 'bold', fontSize: 14 }
});

export default TacticalMap;
