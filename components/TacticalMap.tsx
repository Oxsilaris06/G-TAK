/**
 * TACTICAL MAP - VERSION AMÉLIORÉE
 * * Améliorations:
 * - Rate limiting côté WebView pour éviter le spam du pont JS
 * - Meilleure gestion des gestures (distinction Drag vs Pan vs Click)
 * - Optimisation des re-renders
 * - Support Offline
 */

import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { UserData, PingData } from '../types';

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
  navTargetId?: string | null;
  pingMode?: boolean; 
  nightOpsMode?: boolean;
  initialCenter?: {lat: number, lng: number, zoom: number};
  isLandscape?: boolean;
  maxTrailsPerUser?: number;
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
  
  // Rate limiter pour la création de ping
  const lastPingTime = useRef(0);

  const handlePingThrottled = (loc: { lat: number; lng: number }) => {
    const now = Date.now();
    if (now - lastPingTime.current > 500) { // 500ms throttle
        lastPingTime.current = now;
        onPing(loc);
    }
  };

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
        /* Base styles */
        body { margin: 0; padding: 0; background: #000; font-family: sans-serif; overflow: hidden; user-select: none; -webkit-user-select: none; }
        #map { width: 100vw; height: 100vh; background: #000; }
        
        body.night-ops {
            filter: sepia(100%) hue-rotate(-50deg) saturate(300%) contrast(1.2) brightness(0.8);
        }

        /* Marker Styles - Users */
        .tac-marker-root { position: relative; display: flex; justify-content: center; align-items: center; width: 80px; height: 80px; pointer-events: none; }
        .tac-cone-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; transition: transform 0.1s linear; }
        .tac-circle-id { position: absolute; z-index: 10; width: 32px; height: 32px; border-radius: 50%; border: 2px solid white; display: flex; justify-content: center; align-items: center; box-shadow: 0 0 5px rgba(0,0,0,0.5); top: 50%; left: 50%; transform: translate(-50%, -50%); transition: all 0.3s ease; }
        .tac-circle-id span { color: white; font-family: monospace; font-size: 10px; font-weight: 900; text-shadow: 0 1px 2px black; }
        
        .leaflet-ping-pane { z-index: 2000 !important; }

        @keyframes heartbeat { 0% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 50% { transform: translate(-50%, -50%) scale(1.4); box-shadow: 0 0 20px 10px rgba(239, 68, 68, 0); } 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }
        .tac-marker-heartbeat .tac-circle-id { animation: heartbeat 1.5s infinite ease-in-out !important; border-color: #ef4444 !important; background-color: rgba(239, 68, 68, 0.8) !important; z-index: 9999 !important; }

        /* --- PING STYLES --- */
        
        .ping-container {
            position: absolute;
            left: 0; top: 0;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            transform: translate(-50%, -50%) scale(var(--ping-scale, 1));
            transform-origin: center center;
            /* CRITICAL: pointer-events none on wrapper so clicks pass to map if missed */
            pointer-events: none; 
            -webkit-tap-highlight-color: transparent;
        }

        .ping-label { 
            background: rgba(0,0,0,0.85); color: white; padding: 4px 8px;
            border-radius: 4px; font-size: 11px; font-weight: bold; margin-bottom: 2px; 
            border: 1px solid rgba(255,255,255,0.4); 
            white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis;
            box-shadow: 0 2px 4px rgba(0,0,0,0.5);
            pointer-events: auto; /* Label handles its own clicks */
        }

        .ping-icon { 
            font-size: 32px; 
            filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.8)); 
            pointer-events: auto; /* Icon handles interactions */
            padding: 20px; /* Generous touch area */
            margin: -20px; 
            transition: transform 0.2s, filter 0.2s; 
        }

        .ping-dragging .ping-icon {
            transform: scale(1.4);
            filter: drop-shadow(0px 10px 15px rgba(255, 255, 255, 0.6));
            z-index: 9999;
        }
        
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
        // --- MAP INITIALIZATION ---
        const map = L.map('map', { 
            zoomControl: false, 
            attributionControl: false, 
            doubleClickZoom: false, 
            tap: false, 
            dragging: true 
        }).setView([${startLat}, ${startLng}], ${startZoom});
        
        function updateZoomScale() {
            const zoom = map.getZoom();
            let scale = 1.0;
            if (zoom <= 10) scale = 1.2;
            else if (zoom <= 14) scale = 1.0;
            else if (zoom <= 16) scale = 0.8;
            else scale = 0.6;
            document.documentElement.style.setProperty('--ping-scale', scale);
        }
        map.on('zoom', updateZoomScale);
        updateZoomScale();

        // --- TILES ---
        const commonOptions = { maxZoom: 19, useCache: true, crossOrigin: true, edgeBufferTiles: 2 };
        const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { ...commonOptions });
        const cartoLabels = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', { ...commonOptions, subdomains:'abcd' });

        const layers = {
            dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { ...commonOptions, subdomains:'abcd' }),
            light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { ...commonOptions, subdomains:'abcd' }),
            satellite: esriSat,
            hybrid: L.layerGroup([
                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { ...commonOptions }),
                cartoLabels
            ]),
            custom: null
        };
        
        let currentLayer = layers.dark; 
        currentLayer.addTo(map);

        map.createPane('trailPane'); map.getPane('trailPane').style.zIndex = 400;
        map.createPane('userPane'); map.getPane('userPane').style.zIndex = 600;
        map.createPane('pingPane'); map.getPane('pingPane').style.zIndex = 2000; 

        // --- STATE ---
        const markers = {};
        const trails = {}; 
        const activePings = {}; 
        let navLine = null;
        let pingMode = false;
        let autoCentered = ${initialAutoCentered};
        let maxTrails = 500;
        let pendingUpdates = {}; 
        
        // --- TOUCH / DRAG STATE ---
        let dragTargetId = null;
        let pressTimer = null;
        let startPos = null; // {x, y}
        
        function sendToApp(data) { 
            if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(data));
        }

        // --- GLOBAL EVENT LISTENERS (For Dragging Reliability) ---
        // 1. TOUCH START (Delegated)
        document.addEventListener('touchstart', (e) => {
            // Find if we touched a ping icon
            const icon = e.target.closest('.ping-icon');
            if (!icon) return;
            
            const id = icon.dataset.id;
            if (!id) return;

            // Store start position to detect scrolling
            startPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            
            // Start Long Press Timer
            pressTimer = setTimeout(() => {
                // TIMER FIRED: Start Dragging
                dragTargetId = id;
                map.dragging.disable(); // FREEZE MAP
                
                const marker = activePings[id];
                if (marker) {
                    const el = marker.getElement();
                    if(el) el.classList.add('ping-dragging');
                }
                
                // Haptic Feedback
                sendToApp({ type: 'PING_LONG_PRESS', id: id });
                pressTimer = null;
            }, 400); // 400ms delay for long press
        }, { passive: false });

        // 2. TOUCH MOVE (Delegated)
        document.addEventListener('touchmove', (e) => {
            if (dragTargetId) {
                // DRAGGING IN PROGRESS
                e.preventDefault(); // Kill scroll completely
                e.stopPropagation();
                
                const touch = e.touches[0];
                // Move marker to finger
                const point = L.point(touch.clientX, touch.clientY);
                const latlng = map.containerPointToLatLng(point);
                
                const marker = activePings[dragTargetId];
                if (marker) marker.setLatLng(latlng);
                return;
            }

            // NOT DRAGGING YET - Check for scroll
            if (pressTimer && startPos) {
                const touch = e.touches[0];
                const dx = touch.clientX - startPos.x;
                const dy = touch.clientY - startPos.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                // If moved > 10px, user is scrolling/panning -> Cancel Long Press
                if (dist > 10) {
                    clearTimeout(pressTimer);
                    pressTimer = null;
                    startPos = null;
                }
            }
        }, { passive: false });

        // 3. TOUCH END (Delegated)
        document.addEventListener('touchend', (e) => {
            // CASE A: Was Dragging
            if (dragTargetId) {
                const id = dragTargetId;
                dragTargetId = null;
                map.dragging.enable(); // Unfreeze Map
                
                const marker = activePings[id];
                if (marker) {
                    const el = marker.getElement();
                    if(el) el.classList.remove('ping-dragging');
                    
                    const newPos = marker.getLatLng();
                    // Optimistic update
                    pendingUpdates[id] = { lat: newPos.lat, lng: newPos.lng };
                    sendToApp({ type: 'PING_MOVE', id: id, lat: newPos.lat, lng: newPos.lng });
                    
                    // Cleanup optimistic lock after 5s
                    setTimeout(() => { delete pendingUpdates[id]; }, 5000);
                }
                
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // CASE B: Was Pressing (but timer didn't fire) -> CLICK
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
                startPos = null;
                
                // Check what we clicked (double check it is still the icon)
                const icon = e.target.closest('.ping-icon');
                if (icon && icon.dataset.id) {
                    sendToApp({ type: 'PING_CLICK', id: icon.dataset.id });
                    e.preventDefault(); 
                    e.stopPropagation();
                }
            }
        }, { passive: false });


        // --- DATA HANDLERS ---
        function hexToRgba(hex, alpha) {
            let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
            return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
        }

        map.on('moveend', () => {
            const center = map.getCenter();
            sendToApp({ type: 'MAP_MOVE_END', center: {lat: center.lat, lng: center.lng}, zoom: map.getZoom() });
        });

        map.on('click', (e) => {
            if (dragTargetId) return;
            if (pingMode) sendToApp({ type: 'MAP_CLICK', lat: e.latlng.lat, lng: e.latlng.lng });
        });

        function handleData(data) {
            if (data.type === 'UPDATE_MAP') {
                pingMode = data.pingMode; 
                if(data.maxTrailsPerUser) maxTrails = data.maxTrailsPerUser;
                
                document.body.className = ''; 
                if (data.nightOpsMode) document.body.classList.add('night-ops');
                if (data.isLandscape) document.body.classList.add('landscape');
                
                updateMapMode(data.mode, data.customMapUrl);
                updateMarkers(data.me, data.peers, data.showTrails);
                updatePings(data.pings, data.showPings);
                updateNavigation(data.me, data.navTargetId, data.peers);

                if(data.me && typeof data.me.head === 'number') {
                    const el = document.getElementById('compass-rose');
                    if(el) el.style.transform = 'rotate(' + (-data.me.head) + 'deg)';
                }

                if (!autoCentered && data.me && data.me.lat !== 0) {
                      map.setView([data.me.lat, data.me.lng], 16);
                      autoCentered = true;
                }
            }
        }

        function updateMapMode(mode, customUrl) {
             if (mode === 'custom' && customUrl) {
                if (!layers.custom || layers.custom._url !== customUrl) {
                    if(layers.custom) map.removeLayer(layers.custom);
                    const isLocal = customUrl.startsWith('file') || customUrl.startsWith('content');
                    const Cls = (!isLocal && L.tileLayer.pouchDbcached) ? L.tileLayer.pouchDbcached : L.tileLayer;
                    layers.custom = Cls(customUrl, { maxZoom: 20, useCache: !isLocal, crossOrigin: true });
                }
            }
            let newLayer = (mode === 'custom' && layers.custom) ? layers.custom : (layers[mode] || layers.dark);
            if (currentLayer !== newLayer) { map.removeLayer(currentLayer); newLayer.addTo(map); currentLayer = newLayer; }
        }

        function updatePings(serverPings, showPings) {
            if (!showPings) { 
                Object.keys(activePings).forEach(id => { map.removeLayer(activePings[id]); delete activePings[id]; }); 
                return; 
            }
            
            const currentIds = serverPings.map(p => p.id);
            Object.keys(activePings).forEach(id => { 
                if(!currentIds.includes(id)) { map.removeLayer(activePings[id]); delete activePings[id]; } 
            });
            
            serverPings.forEach(p => {
                if (dragTargetId === p.id) return; // Don't update dragged ping from server

                // Optimistic check
                if (pendingUpdates[p.id]) {
                    const dLat = Math.abs(p.lat - pendingUpdates[p.id].lat);
                    const dLng = Math.abs(p.lng - pendingUpdates[p.id].lng);
                    if (dLat < 0.0001 && dLng < 0.0001) delete pendingUpdates[p.id];
                    else return;
                }

                const iconChar = (p.type === 'HOSTILE') ? '🔴' : (p.type === 'FRIEND') ? '🔵' : '👁️';
                const color = (p.type === 'HOSTILE') ? '#ef4444' : (p.type === 'FRIEND') ? '#22c55e' : '#eab308';
                
                // IMPORTANT: data-id on the icon for the delegate listener
                const html = \`<div class="ping-container">
                    <div class="ping-label" id="lbl-\${p.id}" style="border-color: \${color}">\${p.msg}</div>
                    <div class="ping-icon" data-id="\${p.id}" id="icon-\${p.id}">\${iconChar}</div>
                </div>\`;

                if (activePings[p.id]) {
                    activePings[p.id].setLatLng([p.lat, p.lng]);
                    const el = activePings[p.id].getElement();
                    if(el) {
                        const lbl = el.querySelector('#lbl-' + p.id);
                        if(lbl) { lbl.innerText = p.msg; lbl.style.borderColor = color; }
                    }
                } else {
                    const icon = L.divIcon({ className: 'custom-div-icon', html: html, iconSize: [0, 0] });
                    const m = L.marker([p.lat, p.lng], { icon: icon, pane: 'pingPane', draggable: false, zIndexOffset: 1000 }).addTo(map);
                    activePings[p.id] = m;
                    
                    // Stop Propagation on Add so map doesn't get the clicks immediately
                    m.on('add', () => {
                        const el = m.getElement();
                        if(!el) return;
                        
                        const lbl = el.querySelector('.ping-label');
                        if (lbl) {
                            // Label click is separate
                            L.DomEvent.disableClickPropagation(lbl);
                            lbl.addEventListener('click', () => sendToApp({ type: 'PING_CLICK', id: p.id }));
                            lbl.addEventListener('touchstart', (e) => e.stopPropagation());
                        }
                    });
                }
            });
        }

        // --- OTHER UPDATES (Markers, Nav) ---
        function updateMarkers(me, peers, showTrails) {
            const validPeers = Object.values(peers).filter(p => p.id !== me.id);
            const all = [me, ...validPeers].filter(u => u && u.lat);
            const activeIds = all.map(u => u.id);
            Object.keys(markers).forEach(id => { if(!activeIds.includes(id)) { map.removeLayer(markers[id]); delete markers[id]; } });
            
            if (showTrails) {
                 all.forEach(u => {
                    if (!trails[u.id]) trails[u.id] = [];
                    const segs = trails[u.id];
                    const pt = [u.lat, u.lng];
                    let last = null;
                    if (segs.length > 0) {
                        const lls = segs[segs.length - 1].getLatLngs();
                        if (lls.length > 0) last = lls[lls.length - 1];
                    }
                    // Simple distance check
                    if (!last || Math.abs(last.lat - pt[0]) > 0.00005 || Math.abs(last.lng - pt[1]) > 0.00005) {
                        const color = u.status === 'CONTACT' ? '#ef4444' : u.status === 'CLEAR' ? '#22c55e' : u.status === 'BUSY' ? '#a855f7' : u.paxColor || '#3b82f6';
                        if (!segs.length || segs[segs.length-1].options.color !== color) {
                            segs.push(L.polyline([last || pt, pt], { color, weight: 2, opacity: 0.6, dashArray: '4, 4', pane: 'trailPane' }).addTo(map));
                        } else {
                            segs[segs.length-1].addLatLng(pt);
                        }
                    }
                    // Pruning (Simplified)
                    let count = 0; segs.forEach(s => count += s.getLatLngs().length);
                    if (count > maxTrails && segs.length > 0) {
                        const rem = count - maxTrails;
                        const pts = segs[0].getLatLngs();
                        if (pts.length <= rem) { map.removeLayer(segs.shift()); }
                        else { segs[0].setLatLngs(pts.slice(rem)); }
                    }
                 });
            } else {
                 Object.values(trails).forEach(segs => segs.forEach(s => map.removeLayer(s)));
                 for(let k in trails) delete trails[k];
            }

            all.forEach(u => {
                const color = u.status === 'CONTACT' ? '#ef4444' : u.status === 'CLEAR' ? '#22c55e' : u.status === 'BUSY' ? '#a855f7' : u.paxColor || '#3b82f6';
                const bg = hexToRgba(color, 0.6);
                const rot = u.head || 0;
                const hb = u.status === 'CONTACT' ? 'tac-marker-heartbeat' : '';
                
                const html = \`<div class="tac-marker-root \${hb}"><div class="tac-cone-container" style="transform: rotate(\${rot}deg);"><svg viewBox="0 0 100 100" width="80" height="80"><path d="M50 50 L10 0 A60 60 0 0 1 90 0 Z" fill="\${color}" fill-opacity="0.3" stroke="\${color}" stroke-width="1" stroke-opacity="0.5" /></svg></div><div class="tac-circle-id" style="background-color: \${bg}; border-color: \${color};"><span>\${u.callsign ? u.callsign.substring(0,3) : 'UNK'}</span></div></div>\`;
                const icon = L.divIcon({ className: 'custom-div-icon', html: html, iconSize: [80, 80], iconAnchor: [40, 40] });
                
                if (markers[u.id]) { markers[u.id].setLatLng([u.lat, u.lng]); markers[u.id].setIcon(icon); markers[u.id].setZIndexOffset(u.id === me.id ? 200 : 100); } 
                else { markers[u.id] = L.marker([u.lat, u.lng], { icon: icon, pane: 'userPane' }).addTo(map); }
            });
        }
        
        function updateNavigation(me, targetId, peers) {
             if (navLine) { map.removeLayer(navLine); navLine = null; }
             if (!targetId || !me || !me.lat || !peers[targetId]) return;
             const t = peers[targetId];
             navLine = L.polyline([[me.lat, me.lng], [t.lat, t.lng]], { color: '#06b6d4', weight: 4, dashArray: '5, 10', opacity: 0.9 }).addTo(map);
        }

        document.addEventListener('message', (event) => handleData(JSON.parse(event.data)));
        window.addEventListener('message', (event) => handleData(JSON.parse(event.data)));
      </script>
    </body>
    </html>
  `;
  }, []); 

  useEffect(() => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({
        type: 'UPDATE_MAP', me, peers, pings, mode: mapMode, customMapUrl,
        showTrails, showPings, isHost,
        userArrowColor, navTargetId, pingMode, nightOpsMode, isLandscape, maxTrailsPerUser
      }));
    }
  }, [me, peers, pings, mapMode, customMapUrl, showTrails, showPings, isHost, userArrowColor, navTargetId, pingMode, nightOpsMode, isLandscape, maxTrailsPerUser]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_CLICK') handlePingThrottled({ lat: data.lat, lng: data.lng }); 
      if (data.type === 'PING_CLICK') onPingClick(data.id); 
      if (data.type === 'PING_LONG_PRESS') onPingLongPress(data.id);
      if (data.type === 'PING_MOVE') onPingMove({ ...pings.find(p => p.id === data.id)!, lat: data.lat, lng: data.lng });
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
        allowFileAccess={true} 
        allowUniversalAccessFromFileURLs={true} 
        renderLoading={() => <ActivityIndicator size="large" color="#3b82f6" style={styles.loader} />}
        cacheEnabled={true}
        cacheMode='LOAD_DEFAULT'
        androidHardwareAccelerationDisabled={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', height: '100%' },
  loader: { position: 'absolute', top: '50%', left: '50%', transform: [{translateX: -25}, {translateY: -25}] }
});

export default TacticalMap;
