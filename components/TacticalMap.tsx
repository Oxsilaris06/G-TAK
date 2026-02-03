import React, { useEffect, useRef, useMemo, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { UserData, PingData } from '../types';
import { MaterialIcons } from '@expo/vector-icons';

// Configuration de MapLibre (Pas de token nécessaire pour les sources ouvertes)
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
  
  // --- Props ajoutées pour compatibilité App.tsx ---
  isLandscape?: boolean;
  maxTrailsPerUser?: number;
  // -----------------------------------------------

  onPing: (loc: { lat: number; lng: number }) => void;
  onPingMove: (ping: PingData) => void;
  onPingClick: (id: string) => void; 
  onPingLongPress: (id: string) => void;
  onNavStop: () => void;
  onMapMoveEnd?: (center: {lat: number, lng: number}, zoom: number) => void;
}

// Style JSON pour la vue Satellite gratuite (ESRI World Imagery)
const SATELLITE_STYLE = {
  version: 8,
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: 'Esri, DigitalGlobe, GeoEye, i-cubed, USDA FSA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, and the GIS User Community'
    }
  },
  layers: [
    {
      id: 'esri-satellite-layer',
      type: 'raster',
      source: 'esri-satellite',
      minzoom: 0,
      maxzoom: 22
    }
  ]
};

// URLs de styles MapLibre (Styles vectoriels gratuits)
const MAP_STYLES = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
};

const TacticalMap: React.FC<TacticalMapProps> = ({
  me, peers, pings, mapMode, customMapUrl, showTrails, showPings, isHost, userArrowColor, navTargetId, pingMode, nightOpsMode, initialCenter,
  isLandscape, 
  maxTrailsPerUser = 50, // Valeur par défaut
  onPing, onPingMove, onPingClick, onPingLongPress, onNavStop, onMapMoveEnd
}) => {
  const cameraRef = useRef<MapLibreGL.Camera>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  
  // État local pour stocker les traces
  const [trails, setTrails] = useState<Record<string, number[][]>>({});

  // État pour le mode de suivi (Nord ou Boussole)
  // CORRECTION: UserTrackingMode (singulier) au lieu de UserTrackingModes (pluriel)
  const [userTrackingMode, setUserTrackingMode] = useState<any>(MapLibreGL.UserTrackingMode.Follow);
  
  // État pour l'orientation visuelle de la boussole
  const [mapHeading, setMapHeading] = useState(0);

  // Mise à jour des traces
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
                
                // Vérification de mouvement minimal pour éviter de spammer des points au même endroit
                if (!lastPos || (Math.abs(lastPos[0] - currentPos[0]) > 0.0001 || Math.abs(lastPos[1] - currentPos[1]) > 0.0001)) {
                    // Utilisation de maxTrailsPerUser pour limiter la longueur de la traînée
                    newTrails[peer.id] = [...newTrails[peer.id], currentPos].slice(-maxTrailsPerUser);
                }
            }
        });
        return newTrails;
    });
  }, [peers, showTrails, maxTrailsPerUser]);

  // Fonction de bascule de la boussole
  const toggleCompass = () => {
    // Si on est déjà en mode boussole (suivi du cap)
    // CORRECTION: Utilisation de UserTrackingMode (singulier)
    if (userTrackingMode === MapLibreGL.UserTrackingMode.FollowWithHeading) {
        // Clic 2 : Retour au Nord (Follow simple)
        setUserTrackingMode(MapLibreGL.UserTrackingMode.Follow);
        // On force l'animation de retour à 0°
        cameraRef.current?.setCamera({ heading: 0, animationDuration: 500 });
        setMapHeading(0); 
    } else {
        // Clic 1 : Mode Boussole (Heading)
        setUserTrackingMode(MapLibreGL.UserTrackingMode.FollowWithHeading);
    }
  };

  // Sources GeoJSON
  const trailsSource = useMemo(() => {
    if (!showTrails) return { type: 'FeatureCollection', features: [] };
    
    const features = Object.entries(trails).map(([id, coordinates]) => {
        if (coordinates.length < 2) return null;
        return {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: coordinates
            },
            properties: { id }
        };
    }).filter(f => f !== null);

    return { type: 'FeatureCollection', features };
  }, [trails, showTrails]);

  // Données des pairs avec orientation
  const peerFeatureCollection = useMemo(() => {
    const features = Object.values(peers).map(peer => ({
      type: 'Feature',
      key: peer.id,
      id: peer.id,
      geometry: {
        type: 'Point',
        coordinates: [peer.location.lng, peer.location.lat],
      },
      properties: {
        id: peer.id,
        name: peer.username,
        role: peer.role,
        team: peer.team || 'NEUTRAL',
        // Orientation pour le cône de vision (0 = Nord, rotation horaire)
        heading: peer.orientation || 0,
        color: peer.team === 'RED' ? '#ef4444' : (peer.team === 'BLUE' ? '#3b82f6' : '#10b981')
      }
    }));
    return { type: 'FeatureCollection', features };
  }, [peers]);

  const mapStyle = useMemo(() => {
    if (mapMode === 'custom' && customMapUrl) return customMapUrl;
    if (mapMode === 'satellite') return JSON.stringify(SATELLITE_STYLE);
    if (mapMode === 'light') return MAP_STYLES.light;
    return MAP_STYLES.dark;
  }, [mapMode, customMapUrl]);

  // Handlers
  const handlePress = (e: any) => {
    const { geometry } = e;
    if (geometry && geometry.coordinates) {
      onPing({
        lng: geometry.coordinates[0],
        lat: geometry.coordinates[1]
      });
    }
  };

  const handleLongPress = (e: any) => {
    const { geometry } = e;
    if (geometry && geometry.coordinates) {
        onPing({
            lng: geometry.coordinates[0],
            lat: geometry.coordinates[1]
        });
    }
  };

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
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [me.location.lng, me.location.lat],
                        [targetLoc.lng, targetLoc.lat]
                    ]
                },
                properties: {}
            }]
        };
    }
    return { type: 'FeatureCollection', features: [] };
  }, [navTargetId, pings, peers, me.location]);


  return (
    <View style={styles.container}>
      <MapLibreGL.MapView
        style={styles.map}
        styleJSON={mapMode === 'satellite' ? JSON.stringify(SATELLITE_STYLE) : undefined}
        styleURL={mapMode !== 'satellite' ? (mapStyle as string) : undefined}
        logoEnabled={false}
        attributionEnabled={false}
        rotateEnabled={true}
        compassEnabled={false} // Désactivé pour utiliser notre boussole custom
        onPress={handlePress}
        onLongPress={handleLongPress}
        onDidFinishLoadingMap={() => setIsMapReady(true)}
        // Mise à jour de l'orientation de la boussole
        onRegionIsChanging={(e) => {
            if (e.properties && typeof e.properties.heading === 'number') {
                setMapHeading(e.properties.heading);
            }
        }}
        onRegionDidChange={(e) => {
            if (e.properties && typeof e.properties.heading === 'number') {
                setMapHeading(e.properties.heading);
            }
            if (onMapMoveEnd && e.geometry && e.properties) {
                onMapMoveEnd(
                    { lng: e.geometry.coordinates[0], lat: e.geometry.coordinates[1] },
                    e.properties.zoomLevel
                );
            }
        }}
      >
        <MapLibreGL.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: initialCenter ? [initialCenter.lng, initialCenter.lat] : [me.location.lng, me.location.lat],
            zoomLevel: initialCenter ? initialCenter.zoom : 15,
          }}
          followUserLocation={!navTargetId}
          followUserMode={userTrackingMode}
        />

        {/* --- COUCHE JOUEUR LOCAL (Me) --- */}
        {/* Utilise le capteur natif avec le style par défaut qui est un cercle avec cône de vision */}
        <MapLibreGL.UserLocation
          visible={true}
          animated={true}
          showsUserHeadingIndicator={true} 
          renderMode="normal"
        />

        {showTrails && (
             <MapLibreGL.ShapeSource id="trailsSource" shape={trailsSource as any}>
                <MapLibreGL.LineLayer
                    id="trailsLine"
                    style={{
                        lineColor: '#00FFFF',
                        lineWidth: 1,
                        lineOpacity: 0.5
                    }}
                />
            </MapLibreGL.ShapeSource>
        )}

        {navTargetId && (
            <MapLibreGL.ShapeSource id="navLineSource" shape={navLineSource as any}>
                <MapLibreGL.LineLayer
                    id="navLine"
                    style={{
                        lineColor: '#FFD700',
                        lineWidth: 3,
                        lineDasharray: [2, 2],
                        lineOpacity: 0.8
                    }}
                />
            </MapLibreGL.ShapeSource>
        )}

        {/* --- COUCHE PEERS (Autres Opérateurs) --- */}
        <MapLibreGL.ShapeSource id="peersSource" shape={peerFeatureCollection as any}>
            {/* 1. Cercle de position (Semi-transparent et taille dynamique) */}
            <MapLibreGL.CircleLayer
                id="peerCircles"
                style={{
                    // Rayon interpolé selon le zoom : Zoom 10 -> 4px, Zoom 15 -> 10px, Zoom 20 -> 25px
                    circleRadius: [
                        'interpolate', ['linear'], ['zoom'],
                        10, 4,
                        15, 10,
                        22, 30
                    ],
                    circleColor: ['get', 'color'],
                    circleStrokeWidth: 2,
                    circleStrokeColor: '#FFFFFF',
                    circleOpacity: 0.6 // Semi-transparent
                }}
            />
            
            {/* 2. CÔNE DE VISION / FLÈCHE DE DIRECTION */}
            <MapLibreGL.SymbolLayer
                id="peerDirection"
                style={{
                    textField: '▲', 
                    // Taille interpolée selon le zoom pour rester proportionnelle
                    textSize: [
                        'interpolate', ['linear'], ['zoom'],
                        10, 8,
                        15, 18,
                        22, 40
                    ],
                    textColor: ['get', 'color'],
                    textRotate: ['get', 'heading'], 
                    textRotationAlignment: 'map', 
                    textAllowOverlap: true,   // Permet la superposition
                    textIgnorePlacement: true, // Ignore les collisions
                    textOffset: [0, 0], 
                    textOpacity: 0.9
                }}
            />

            {/* 3. Nom de l'opérateur */}
            <MapLibreGL.SymbolLayer
                id="peerLabels"
                style={{
                    textField: ['get', 'name'],
                    textSize: 12,
                    textOffset: [0, 2], 
                    textColor: '#FFFFFF',
                    textHaloColor: '#000000',
                    textHaloWidth: 1,
                    textAllowOverlap: true,   // Les noms peuvent se superposer
                    textIgnorePlacement: true // Les noms s'affichent toujours
                }}
            />
        </MapLibreGL.ShapeSource>

        {showPings && pings.map((ping) => (
            <MapLibreGL.PointAnnotation
                key={ping.id}
                id={ping.id}
                coordinate={[ping.location.lng, ping.location.lat]}
                draggable={true}
                onSelected={() => onPingClick(ping.id)}
                onDragEnd={(payload: any) => {
                    const { geometry } = payload;
                    if (geometry) {
                        onPingMove({
                            ...ping,
                            location: {
                                lng: geometry.coordinates[0],
                                lat: geometry.coordinates[1]
                            }
                        });
                    }
                }}
            >
                <View style={[styles.pingMarker, { backgroundColor: ping.color || '#F00' }]}>
                   <View style={styles.pingCenter} />
                </View>
                <MapLibreGL.Callout title={ping.type.toUpperCase()} />
            </MapLibreGL.PointAnnotation>
        ))}

      </MapLibreGL.MapView>

      {/* --- UI OVERLAYS --- */}
      
      {/* BOUSSOLE INTÉRACTIVE */}
      <TouchableOpacity style={styles.compassBtn} onPress={toggleCompass} activeOpacity={0.7}>
          <MaterialIcons 
            name="explore" 
            size={36} 
            // CORRECTION: Utilisation de UserTrackingMode (singulier)
            color={userTrackingMode === MapLibreGL.UserTrackingMode.FollowWithHeading ? "#FFD700" : "white"} 
            style={{ transform: [{ rotate: `${-mapHeading}deg` }] }}
          />
      </TouchableOpacity>

      {/* Bouton pour Arrêter la Navigation */}
      {navTargetId && (
          <View style={styles.navControls}>
              <TouchableOpacity style={styles.stopNavBtn} onPress={onNavStop}>
                  <MaterialIcons name="navigation" size={20} color="#000" />
                  <Text style={styles.stopNavText}>ARRÊT NAV</Text>
                  <MaterialIcons name="close" size={20} color="#000" />
              </TouchableOpacity>
          </View>
      )}

      {nightOpsMode && (
        <View style={styles.nightOpsOverlay} pointerEvents="none" />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  nightOpsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 0, 0, 0.15)',
    zIndex: 999,
  },
  pingMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'white',
    opacity: 0.9
  },
  pingCenter: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'white'
  },
  compassBtn: {
    position: 'absolute',
    top: 50,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    zIndex: 100,
    elevation: 4
  },
  navControls: {
      position: 'absolute',
      top: 50,
      alignSelf: 'center',
      zIndex: 100,
  },
  stopNavBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#FFD700',
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      elevation: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 2,
      gap: 8
  },
  stopNavText: {
      color: '#000',
      fontWeight: 'bold',
      fontSize: 14
  }
});

export default TacticalMap;
