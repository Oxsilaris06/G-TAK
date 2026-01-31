import React, { useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { UserData, PingData } from '../types';

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
  isLandscape?: boolean;
  maxTrailsPerUser?: number; // Prop pour configurer la limite de points
  onPing: (loc: { lat: number; lng: number }) => void;
  onPingMove: (ping: PingData) => void;
  onPingClick: (id: string) => void; 
  onPingLongPress: (id: string) => void; 
  onNavStop: () => void;
  onMapMoveEnd?: (center: {lat: number, lng: number}, zoom: number) => void;
}

const TacticalMap: React.FC<TacticalMapProps> = ({
  me, peers, pings, mapMode, customMapUrl, showTrails, showPings, isHost, userArrowColor, navTargetId, pingMode, nightOpsMode, initialCenter, isLandscape, maxTrailsPerUser = 500,
  onPing, onPingMove, onPingClick, onPingLongPress, onNavStop, onMapMoveEnd
}) => {
  const webViewRef = useRef<WebView>(null);

  const leafletHTML = useMemo(() => {
      const startLat = initialCenter ? initialCenter.lat : 48.85;
      const startLng = initialCenter ? initialCenter.lng : 2.35;
      const startZoom = initialCenter ? initialCenter.zoom : 13;
      const initialAutoCentered = !!initialCenter;

      return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      
      <style>
        body { margin: 0; padding: 0; background: #000; font-family: sans-serif; transition: filter 0.5s ease; }
        #map { width: 100vw; height: 100vh; }
        
        body.night-ops {
            filter: sepia(100%) hue-rotate(-50deg) saturate(300%) contrast(1.2) brightness(0.8);
        }

        .tac-marker-root { position: relative; display: flex; justify-content: center; align-items: center; width: 80px; height: 80px; }
        .tac-cone-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; transition: transform 0.1s linear; pointer-events: none; z-index: 1; }
        
        .tac-circle-id { position: absolute; z-index: 10; width: 32px; height: 32px; border-radius: 50%; border: 2px solid white; display: flex; justify-content: center; align-items: center; box-shadow: 0 0 5px rgba(0,0,0,0.5); top: 50%; left: 50%; transform: translate(-50%, -50%); transition: all 0.3s ease; }
        .tac-circle-id span { color: white; font-family: monospace; font-size: 10px; font-weight: 900; text-shadow: 0 1px 2px black; }
        
        @keyframes heartbeat { 0% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 50% { transform: translate(-50%, -50%) scale(1.4); box-shadow: 0 0 20px 10px rgba(239, 68, 68, 0); } 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }
        .tac-marker-heartbeat .tac-circle-id { animation: heartbeat 1.5s infinite ease-in-out !important; border-color: #ef4444 !important; background-color: rgba(239, 68, 68, 0.8) !important; z-index: 9999 !important; }

        .ping-marker-box { display: flex; flex-direction: column; align-items: center; width: 100px; cursor: pointer; pointer-events: auto; }
        .ping-icon { font-size: 24px; filter: drop-shadow(0px 2px 2px rgba(0,0,0,0.8)); transition: transform 0.2s; }
        .ping-label { background: rgba(0,0,0,0.7); color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-bottom: 2px; border: 1px solid rgba(255,255,255,0.3); white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }

        /* Compass Styles */
        #compass { position: absolute; top: 20px; left: 20px; width: 60px; height: 60px; z-index: 9999; background: rgba(0,0,0,0.6); border-radius: 50%; border: 2px solid rgba(255,255,255,0.2); display: flex; justify-content: center; align-items: center; backdrop-filter: blur(2px); pointer-events: none; transition: top 0.3s, left 0.3s, bottom 0.3s; }
        
        body.landscape #compass { top: auto; bottom: 20px; left: 20px; }

        #compass-indicator { position: absolute; top: -5px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid #ef4444; z-index: 20; }
        #compass-rose { position: relative; width: 100%; height: 100%; transition: transform 0.1s linear; }
        .compass-label { position: absolute; color: rgba(255,255,255,0.9); font-size: 10px; font-weight: bold; font-family: monospace; }
        .compass-n { top: 4px; left: 50%; transform: translateX(-50%); color: #ef4444; }
        .compass-s { bottom: 4px; left: 50%; transform: translateX(-50%); }
        .compass-e { right: 6px; top: 50%; transform: translateY(-50%); }
        .compass-w { left: 6px; top: 50%; transform: translateY(-50%); }
      </style>

      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <script src="https://unpkg.com/leaflet.offline@2.0.0/dist/leaflet.offline.min.js"></script>
      <script src="https://unpkg.com/leaflet-edgebuffer@1.0.6/src/leaflet.edgebuffer.js"></script>
      <script src="https://unpkg.com/pouchdb@7.3.0/dist/pouchdb.min.js"></script>
      <script src="https://unpkg.com/leaflet.tilelayer.pouchdb@latest/Leaflet.TileLayer.PouchDB.js"></script>
    </head>
    <body>
      <div id="map"></div>
      <div id="compass"><div id="compass-indicator"></div><div id="compass-rose"><span class="compass-label compass-n">N</span><span class="compass-label compass-e">E</span><span class="compass-label compass-s">S</span><span class="compass-label compass-w">O</span></div></div>

      <script>
        // Init Map with touch fix settings
        const map = L.map('map', { 
            zoomControl: false, 
            attributionControl: false, 
            doubleClickZoom: false,
            tap: false // Important for React Native WebView to avoid touch conflict
        }).setView([${startLat}, ${startLng}], ${startZoom});
        
        const commonOptions = {
            maxZoom: 19,
            useCache: true, 
            crossOrigin: true,
            edgeBufferTiles: 2
        };

        function getLayer(url, options) {
            if (L.tileLayer.pouchDbcached) {
                return L.tileLayer.pouchDbcached(url, options);
            }
            return L.tileLayer(url, options);
        }

        const layers = {
            dark: getLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { ...commonOptions, subdomains:'abcd' }),
            light: getLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { ...commonOptions, subdomains:'abcd' }),
            satellite: getLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { ...commonOptions }),
            custom: null
        };
        
        let currentLayer = layers.dark; 
        currentLayer.addTo(map);

        // --- Z-INDEX FIX ---
        // Layers order (bottom to top): tiles -> trailPane -> userPane -> pingPane
        map.createPane('trailPane'); map.getPane('trailPane').style.zIndex = 400;
        map.createPane('userPane'); map.getPane('userPane').style.zIndex = 600;
        map.createPane('pingPane'); map.getPane('pingPane').style.zIndex = 800; // Highest for pings

        const markers = {};
        
        // Structure: trails[userId] = [ L.Polyline(segment1), L.Polyline(segment2), ... ]
        const trails = {}; 
        
        const pingLayer = L.layerGroup({ pane: 'pingPane' }).addTo(map);
        let navLine = null;
        
        let pings = {};
        let userArrowColor = '#3b82f6';
        let pingMode = false;
        let lastMePos = null;
        let autoCentered = ${initialAutoCentered};
        let maxTrails = 500;

        function hexToRgba(hex, alpha) {
            let r = parseInt(hex.slice(1, 3), 16),
                g = parseInt(hex.slice(3, 5), 16),
                b = parseInt(hex.slice(5, 7), 16);
            return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
        }

        function sendToApp(data) { window.ReactNativeWebView.postMessage(JSON.stringify(data)); }
        
        document.addEventListener('message', (event) => handleData(JSON.parse(event.data)));
        window.addEventListener('message', (event) => handleData(JSON.parse(event.data)));

        map.on('moveend', () => {
            const center = map.getCenter();
            sendToApp({ type: 'MAP_MOVE_END', center: {lat: center.lat, lng: center.lng}, zoom: map.getZoom() });
        });

        map.on('click', (e) => {
            if (pingMode) {
                sendToApp({ type: 'MAP_CLICK', lat: e.latlng.lat, lng: e.latlng.lng });
            }
        });

        map.on('dblclick', (e) => {
             sendToApp({ type: 'MAP_DBLCLICK', lat: e.latlng.lat, lng: e.latlng.lng });
        });

        function handleData(data) {
            if (data.type === 'UPDATE_MAP') {
                if(data.userArrowColor) userArrowColor = data.userArrowColor;
                pingMode = data.pingMode; 
                if(data.maxTrailsPerUser) maxTrails = data.maxTrailsPerUser;
                
                if (data.nightOpsMode) document.body.classList.add('night-ops');
                else document.body.classList.remove('night-ops');

                if (data.isLandscape) document.body.classList.add('landscape');
                else document.body.classList.remove('landscape');
                
                updateMapMode(data.mode, data.customMapUrl);
                updateMarkers(data.me, data.peers, data.showTrails);
                updatePings(data.pings, data.showPings, data.isHost, data.me.callsign);
                updateNavigation(data.me, data.navTargetId, data.peers);

                if(data.me && typeof data.me.head === 'number') {
                    const rot = -data.me.head;
                    const el = document.getElementById('compass-rose');
                    if(el) el.style.transform = 'rotate(' + rot + 'deg)';
                }

                if (!autoCentered && data.me && data.me.lat !== 0 && data.me.lng !== 0) {
                      map.setView([data.me.lat, data.me.lng], 16);
                      autoCentered = true;
                }
            }
        }
        
        function updateMapMode(mode, customUrl) {
            if (mode === 'custom' && customUrl) {
                if (!layers.custom || layers.custom._url !== customUrl) {
                    if(layers.custom) map.removeLayer(layers.custom);
                    
                    const isLocalFile = customUrl.startsWith('file://') || customUrl.startsWith('content://');
                    const LayerClass = (!isLocalFile && L.tileLayer.pouchDbcached) ? L.tileLayer.pouchDbcached : L.tileLayer;
                    
                    layers.custom = LayerClass(customUrl, {
                        maxZoom: 20,
                        edgeBufferTiles: 2,
                        useCache: !isLocalFile, 
                        crossOrigin: true
                    });
                }
            }

            let newLayer = layers[mode] || layers.dark;
            if (mode === 'custom' && layers.custom) newLayer = layers.custom;

            if (currentLayer !== newLayer) { 
                map.removeLayer(currentLayer); 
                newLayer.addTo(map); 
                currentLayer = newLayer; 
            }
        }

        function updateMarkers(me, peers, showTrails) {
            const validPeers = Object.values(peers).filter(p => p.id !== me.id);
            const all = [me, ...validPeers].filter(u => u && u.lat);
            const activeIds = all.map(u => u.id);
            
            // Clean up old markers
            Object.keys(markers).forEach(id => { if(!activeIds.includes(id)) { map.removeLayer(markers[id]); delete markers[id]; } });
            
            // Clean up old trails if user left
            Object.keys(trails).forEach(id => { 
                if(!activeIds.includes(id)) { 
                    trails[id].forEach(poly => map.removeLayer(poly));
                    delete trails[id]; 
                } 
            });

            if (!showTrails) {
                // Hide all trails
                Object.values(trails).forEach(userSegments => userSegments.forEach(p => map.removeLayer(p)));
            }

            all.forEach(u => {
                let colorHex = '#71717a'; 
                if (u.status === 'CONTACT') colorHex = '#ef4444';
                else if (u.status === 'CLEAR') colorHex = '#22c55e';
                else if (u.status === 'BUSY') colorHex = '#a855f7';
                else if (u.status === 'PROGRESSION') {
                    colorHex = u.paxColor || '#3b82f6'; 
                } else {
                    colorHex = '#eab308';
                }

                let bgRgba = hexToRgba(colorHex, 0.6);
                const rot = u.head || 0;
                const extraClass = (u.status === 'CONTACT') ? 'tac-marker-heartbeat' : '';
                
                const coneSvg = \`<svg viewBox="0 0 100 100" width="80" height="80" style="overflow:visible;"><path d="M50 50 L10 0 A60 60 0 0 1 90 0 Z" fill="\${colorHex}" fill-opacity="0.3" stroke="\${colorHex}" stroke-width="1" stroke-opacity="0.5" /></svg>\`;
                const iconHtml = \`<div class="tac-marker-root \${extraClass}"><div class="tac-cone-container" style="transform: rotate(\${rot}deg);">\${coneSvg}</div><div class="tac-circle-id" style="background-color: \${bgRgba}; border-color: \${colorHex};"><span>\${u.callsign ? u.callsign.substring(0,3) : 'UNK'}</span></div></div>\`;
                
                const icon = L.divIcon({ className: 'custom-div-icon', html: iconHtml, iconSize: [80, 80], iconAnchor: [40, 40] });
                
                if (markers[u.id]) { 
                    markers[u.id].setLatLng([u.lat, u.lng]); markers[u.id].setIcon(icon); 
                    markers[u.id].setZIndexOffset(u.id === me.id ? 200 : 100); 
                } 
                else { 
                    markers[u.id] = L.marker([u.lat, u.lng], { icon: icon, pane: 'userPane' }).addTo(map); 
                }

                // --- TRAIL SEGMENT LOGIC ---
                if (showTrails) {
                    if (!trails[u.id]) trails[u.id] = [];
                    const userSegments = trails[u.id];
                    const newPt = [u.lat, u.lng];
                    
                    // Logic to avoid spamming points if user hasn't moved
                    // Find last point of last segment
                    let lastPt = null;
                    if (userSegments.length > 0) {
                        const latlngs = userSegments[userSegments.length - 1].getLatLngs();
                        if (latlngs.length > 0) lastPt = latlngs[latlngs.length - 1];
                    }

                    const moved = !lastPt || (Math.abs(lastPt.lat - newPt[0]) > 0.00005 || Math.abs(lastPt.lng - newPt[1]) > 0.00005);

                    if (moved) {
                        const currentColor = colorHex; // Current status color
                        let currentSegment = userSegments.length > 0 ? userSegments[userSegments.length - 1] : null;
                        
                        // Check if we need a new segment (color change)
                        // If currentSegment exists, compare color. 
                        // Note: Leaflet Polyline options.color holds the color.
                        
                        if (!currentSegment || currentSegment.options.color !== currentColor) {
                            // Start NEW Segment
                            // To connect segments, start the new one at the last point of the previous one
                            let segmentPoints = [newPt];
                            if (lastPt) {
                                segmentPoints.unshift(lastPt);
                            }
                            
                            const newPoly = L.polyline(segmentPoints, {
                                color: currentColor,
                                weight: 2,
                                opacity: 0.6,
                                dashArray: '4, 4',
                                pane: 'trailPane'
                            }).addTo(map);
                            
                            userSegments.push(newPoly);
                        } else {
                            // Continue SAME Segment
                            currentSegment.addLatLng(newPt);
                        }
                        
                        // --- PRUNING LOGIC (Max Trails) ---
                        // Count total points
                        let totalPoints = 0;
                        userSegments.forEach(seg => totalPoints += seg.getLatLngs().length);
                        
                        if (totalPoints > maxTrails) {
                            // Remove points from the beginning
                            // We might need to remove full segments or trim the first segment
                            while (totalPoints > maxTrails && userSegments.length > 0) {
                                const firstSeg = userSegments[0];
                                const pts = firstSeg.getLatLngs();
                                
                                if (pts.length <= (totalPoints - maxTrails)) {
                                    // Remove this whole segment
                                    map.removeLayer(firstSeg);
                                    userSegments.shift();
                                    totalPoints -= pts.length;
                                } else {
                                    // Trim this segment
                                    // Leaflet doesn't have a simple 'remove first N points' for Polyline easily without redrawing
                                    // So we slice and setLatLngs
                                    const toRemove = totalPoints - maxTrails;
                                    const newPts = pts.slice(toRemove);
                                    firstSeg.setLatLngs(newPts);
                                    totalPoints -= toRemove;
                                }
                            }
                        }
                    } else {
                        // If just showing, ensure visible
                        userSegments.forEach(seg => { if(!map.hasLayer(seg)) seg.addTo(map); });
                    }
                }
            });
        }
        
        function updateNavigation(me, targetId, peers) {
             if (navLine) { map.removeLayer(navLine); navLine = null; }
             if (!targetId || !me || !me.lat) return;

             const target = peers[targetId];
             if (target && target.lat) {
                 navLine = L.polyline([[me.lat, me.lng], [target.lat, target.lng]], {
                     color: '#06b6d4',
                     weight: 4,
                     dashArray: '5, 10',
                     opacity: 0.9,
                     lineCap: 'round'
                 }).addTo(map);
             }
        }

        function updatePings(serverPings, showPings, isHost, myCallsign) {
            if (!showPings) { 
                pingLayer.clearLayers(); 
                pings = {}; 
                return; 
            }
            
            if (!map.hasLayer(pingLayer)) {
                pingLayer.addTo(map);
            }
            
            const currentIds = serverPings.map(p => p.id);
            
            Object.keys(pings).forEach(id => { 
                if(!currentIds.includes(id)) { 
                    pingLayer.removeLayer(pings[id]); 
                    delete pings[id]; 
                } 
            });
            
            serverPings.forEach(p => {
                const canDrag = isHost || (p.sender === myCallsign);
                const iconChar = (p.type === 'HOSTILE') ? '🔴' : (p.type === 'FRIEND') ? '🔵' : '👁️';
                const color = (p.type === 'HOSTILE') ? '#ef4444' : (p.type === 'FRIEND') ? '#22c55e' : '#eab308';
                
                const html = \`<div id="ping-\${p.id}" class="ping-marker-box"><div class="ping-label" style="border-color: \${color}">\${p.msg}</div><div class="ping-icon">\${iconChar}</div></div>\`;

                if (pings[p.id]) {
                    pings[p.id].setLatLng([p.lat, p.lng]);
                    if(pings[p.id]._icon) pings[p.id]._icon.innerHTML = html;
                    
                    if (canDrag) { 
                        if (!pings[p.id].dragging.enabled()) pings[p.id].dragging.enable();
                    } else { 
                        if (pings[p.id].dragging.enabled()) pings[p.id].dragging.disable();
                    }
                } else {
                    const icon = L.divIcon({ className: 'custom-div-icon', html: iconHtml, iconSize: [100, 60], iconAnchor: [50, 50] });
                    
                    // Fixed Draggable Logic
                    const m = L.marker([p.lat, p.lng], { 
                        icon: icon, 
                        draggable: true, // Init as true, controlled later
                        autoPan: true,
                        pane: 'pingPane'
                    });
                    
                    if (!canDrag) m.dragging.disable();

                    m.on('click', () => sendToApp({ type: 'PING_CLICK', id: p.id }));
                    m.on('contextmenu', () => sendToApp({ type: 'PING_LONG_PRESS', id: p.id }));
                    m.on('dragend', (e) => sendToApp({ type: 'PING_MOVE', id: p.id, lat: e.target.getLatLng().lat, lng: e.target.getLatLng().lng }));
                    
                    pings[p.id] = m;
                    pingLayer.addLayer(m);
                }
            });
        }
      </script>
    </body>
    </html>
  `;
  }, []); 

  // PERFORMANCE FIX: Use useMemo to avoid sending duplicate JSON messages to WebView
  // This prevents the JS thread from overloading the Bridge
  const mapUpdateMessage = useMemo(() => {
      return JSON.stringify({
        type: 'UPDATE_MAP', me, peers, pings, mode: mapMode, customMapUrl,
        showTrails, showPings, isHost,
        userArrowColor, navTargetId, pingMode, nightOpsMode, isLandscape, maxTrailsPerUser
      });
  }, [me, peers, pings, mapMode, customMapUrl, showTrails, showPings, isHost, userArrowColor, navTargetId, pingMode, nightOpsMode, isLandscape, maxTrailsPerUser]);

  useEffect(() => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(mapUpdateMessage);
    }
  }, [mapUpdateMessage]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_CLICK') onPing({ lat: data.lat, lng: data.lng }); 
      if (data.type === 'MAP_DBLCLICK') onPing({ lat: data.lat, lng: data.lng }); 
      if (data.type === 'PING_CLICK') onPingClick(data.id); 
      if (data.type === 'PING_LONG_PRESS') onPingLongPress(data.id);
      if (data.type === 'PING_MOVE') onPingMove({ ...pings.find(p => p.id === data.id)!, lat: data.lat, lng: data.lng });
      if (data.type === 'NAV_STOP') { if (onNavStop) onNavStop(); }
      if (data.type === 'MAP_MOVE_END' && onMapMoveEnd) onMapMoveEnd(data.center, data.zoom);
    } catch(e) {}
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: leafletHTML }}
        style={{ flex: 1, backgroundColor: '#000' }}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        cacheEnabled={true}
        allowFileAccess={true} 
        allowUniversalAccessFromFileURLs={true} 
        renderLoading={() => <ActivityIndicator size="large" color="#3b82f6" style={styles.loader} />}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  loader: { position: 'absolute', top: '50%', left: '50%', transform: [{translateX: -25}, {translateY: -25}] }
});

export default TacticalMap;
