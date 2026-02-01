import React, { useEffect, useRef, useMemo } from 'react';
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
        
        /* Conteneur global du marker */
        .ping-container {
            position: absolute;
            left: 0; 
            top: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            transform: translate(-50%, -50%) scale(var(--ping-scale, 1));
            transform-origin: center center;
            pointer-events: auto;
            -webkit-tap-highlight-color: transparent;
            touch-action: none; /* Important pour que Leaflet ne capture pas tout */
        }

        /* Label */
        .ping-label { 
            background: rgba(0,0,0,0.85); 
            color: white; 
            padding: 4px 8px;
            border-radius: 4px; 
            font-size: 11px; 
            font-weight: bold; 
            margin-bottom: 2px; 
            border: 1px solid rgba(255,255,255,0.4); 
            white-space: nowrap; 
            max-width: 140px; 
            overflow: hidden; 
            text-overflow: ellipsis;
            box-shadow: 0 2px 4px rgba(0,0,0,0.5);
            pointer-events: auto;
        }

        /* Icone */
        .ping-icon { 
            font-size: 32px; 
            filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.8)); 
            pointer-events: auto;
            padding: 20px; /* Zone tactile élargie */
            margin: -20px; 
            transition: transform 0.2s, filter 0.2s; 
        }

        /* Etat "Dragging" */
        .ping-dragging .ping-icon {
            transform: scale(1.4);
            filter: drop-shadow(0px 10px 15px rgba(239, 68, 68, 0.6));
            cursor: grabbing;
        }
        
        /* Compass */
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
        const map = L.map('map', { 
            zoomControl: false, 
            attributionControl: false, 
            doubleClickZoom: false, 
            tap: false, 
            dragging: true 
        }).setView([${startLat}, ${startLng}], ${startZoom});
        
        // --- SCALE MANAGEMENT ---
        function updateZoomScale() {
            const zoom = map.getZoom();
            let scale = 1.0;
            if (zoom <= 10) { scale = 1.2; } 
            else if (zoom <= 14) { scale = 1.0; } 
            else if (zoom <= 16) { scale = 0.8; } 
            else { scale = 0.6; } 
            document.documentElement.style.setProperty('--ping-scale', scale);
        }
        map.on('zoom', updateZoomScale); // zoom fires continuously
        updateZoomScale();

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

        const markers = {};
        const trails = {}; 
        const activePings = {}; 
        let navLine = null;
        
        let pingMode = false;
        let autoCentered = ${initialAutoCentered};
        let maxTrails = 500;
        
        // --- DRAG STATE ---
        let isDraggingPing = null; // ID du ping ou null
        let longPressTimer = null;
        let startX = 0;
        let startY = 0;
        
        // Optimistic UI updates
        let pendingUpdates = {}; 

        function hexToRgba(hex, alpha) {
            let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
            return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
        }

        function sendToApp(data) { 
            const msg = JSON.stringify(data);
            if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(msg);
            }
        }

        // --- MAP EVENTS ---
        map.on('moveend', () => {
            const center = map.getCenter();
            sendToApp({ type: 'MAP_MOVE_END', center: {lat: center.lat, lng: center.lng}, zoom: map.getZoom() });
        });

        map.on('click', (e) => {
            // Un click sur la carte ne doit pas déclencher si on vient de lâcher un ping
            if (isDraggingPing) return;
            if (pingMode) sendToApp({ type: 'MAP_CLICK', lat: e.latlng.lat, lng: e.latlng.lng });
        });

        map.on('dblclick', (e) => {
             sendToApp({ type: 'MAP_DBLCLICK', lat: e.latlng.lat, lng: e.latlng.lng });
        });

        // --- DATA HANDLER ---
        function handleData(data) {
            if (data.type === 'UPDATE_MAP') {
                pingMode = data.pingMode; 
                if(data.maxTrailsPerUser) maxTrails = data.maxTrailsPerUser;
                
                if (data.nightOpsMode) document.body.classList.add('night-ops');
                else document.body.classList.remove('night-ops');

                if (data.isLandscape) document.body.classList.add('landscape');
                else document.body.classList.remove('landscape');
                
                updateMapMode(data.mode, data.customMapUrl);
                updateMarkers(data.me, data.peers, data.showTrails);
                updatePings(data.pings, data.showPings);
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
                    layers.custom = LayerClass(customUrl, { maxZoom: 20, edgeBufferTiles: 2, useCache: !isLocalFile, crossOrigin: true });
                }
            }
            let newLayer = layers[mode] || layers.dark;
            if (mode === 'custom' && layers.custom) newLayer = layers.custom;
            if (currentLayer !== newLayer) { map.removeLayer(currentLayer); newLayer.addTo(map); currentLayer = newLayer; }
        }

        function updateMarkers(me, peers, showTrails) {
            const validPeers = Object.values(peers).filter(p => p.id !== me.id);
            const all = [me, ...validPeers].filter(u => u && u.lat);
            const activeIds = all.map(u => u.id);
            Object.keys(markers).forEach(id => { if(!activeIds.includes(id)) { map.removeLayer(markers[id]); delete markers[id]; } });
            Object.keys(trails).forEach(id => { if(!activeIds.includes(id)) { trails[id].forEach(poly => map.removeLayer(poly)); delete trails[id]; } });

            if (!showTrails) { Object.values(trails).forEach(userSegments => userSegments.forEach(p => map.removeLayer(p))); }

            all.forEach(u => {
                let colorHex = u.status === 'CONTACT' ? '#ef4444' : u.status === 'CLEAR' ? '#22c55e' : u.status === 'BUSY' ? '#a855f7' : u.status === 'PROGRESSION' ? u.paxColor || '#3b82f6' : '#eab308';
                let bgRgba = hexToRgba(colorHex, 0.6);
                const rot = u.head || 0;
                const extraClass = (u.status === 'CONTACT') ? 'tac-marker-heartbeat' : '';
                
                const coneSvg = \`<svg viewBox="0 0 100 100" width="80" height="80" style="overflow:visible;"><path d="M50 50 L10 0 A60 60 0 0 1 90 0 Z" fill="\${colorHex}" fill-opacity="0.3" stroke="\${colorHex}" stroke-width="1" stroke-opacity="0.5" /></svg>\`;
                const iconHtml = \`<div class="tac-marker-root \${extraClass}"><div class="tac-cone-container" style="transform: rotate(\${rot}deg);">\${coneSvg}</div><div class="tac-circle-id" style="background-color: \${bgRgba}; border-color: \${colorHex};"><span>\${u.callsign ? u.callsign.substring(0,3) : 'UNK'}</span></div></div>\`;
                const icon = L.divIcon({ className: 'custom-div-icon', html: iconHtml, iconSize: [80, 80], iconAnchor: [40, 40] });
                
                if (markers[u.id]) { 
                    markers[u.id].setLatLng([u.lat, u.lng]); markers[u.id].setIcon(icon); 
                    markers[u.id].setZIndexOffset(u.id === me.id ? 200 : 100); 
                } else { 
                    markers[u.id] = L.marker([u.lat, u.lng], { icon: icon, pane: 'userPane' }).addTo(map); 
                }

                if (showTrails) {
                    if (!trails[u.id]) trails[u.id] = [];
                    const userSegments = trails[u.id];
                    const newPt = [u.lat, u.lng];
                    let lastPt = null;
                    if (userSegments.length > 0) {
                        const latlngs = userSegments[userSegments.length - 1].getLatLngs();
                        if (latlngs.length > 0) lastPt = latlngs[latlngs.length - 1];
                    }
                    const moved = !lastPt || (Math.abs(lastPt.lat - newPt[0]) > 0.00005 || Math.abs(lastPt.lng - newPt[1]) > 0.00005);
                    if (moved) {
                        const currentColor = colorHex; 
                        let currentSegment = userSegments.length > 0 ? userSegments[userSegments.length - 1] : null;
                        if (!currentSegment || currentSegment.options.color !== currentColor) {
                            let segmentPoints = [newPt];
                            if (lastPt) segmentPoints.unshift(lastPt);
                            const newPoly = L.polyline(segmentPoints, { color: currentColor, weight: 2, opacity: 0.6, dashArray: '4, 4', pane: 'trailPane' }).addTo(map);
                            userSegments.push(newPoly);
                        } else { currentSegment.addLatLng(newPt); }
                        
                        let totalPoints = 0;
                        userSegments.forEach(seg => totalPoints += seg.getLatLngs().length);
                        if (totalPoints > maxTrails) {
                            while (totalPoints > maxTrails && userSegments.length > 0) {
                                const firstSeg = userSegments[0];
                                const pts = firstSeg.getLatLngs();
                                if (pts.length <= (totalPoints - maxTrails)) { map.removeLayer(firstSeg); userSegments.shift(); totalPoints -= pts.length; } 
                                else {
                                    const toRemove = totalPoints - maxTrails;
                                    const newPts = pts.slice(toRemove);
                                    firstSeg.setLatLngs(newPts);
                                    totalPoints -= toRemove;
                                }
                            }
                        }
                    }
                }
            });
        }
        
        function updateNavigation(me, targetId, peers) {
             if (navLine) { map.removeLayer(navLine); navLine = null; }
             if (!targetId || !me || !me.lat) return;
             const target = peers[targetId];
             if (target && target.lat) {
                 navLine = L.polyline([[me.lat, me.lng], [target.lat, target.lng]], { color: '#06b6d4', weight: 4, dashArray: '5, 10', opacity: 0.9, lineCap: 'round' }).addTo(map);
             }
        }


        // --- PINGS LOGIC ---

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
                // 1. SKIP si on est en train de le bouger
                if (isDraggingPing === p.id) return;

                // 2. CHECK Optimistic Update
                if (pendingUpdates[p.id]) {
                      const pending = pendingUpdates[p.id];
                      const dLat = Math.abs(p.lat - pending.lat);
                      const dLng = Math.abs(p.lng - pending.lng);
                      
                      // Si le serveur a rattrapé notre position locale (à peu près), on arrête d'ignorer
                      if (dLat < 0.0001 && dLng < 0.0001) {
                          delete pendingUpdates[p.id];
                      } else {
                          // Sinon, on garde notre position locale
                          return;
                      }
                }

                const iconChar = (p.type === 'HOSTILE') ? '🔴' : (p.type === 'FRIEND') ? '🔵' : '👁️';
                const color = (p.type === 'HOSTILE') ? '#ef4444' : (p.type === 'FRIEND') ? '#22c55e' : '#eab308';
                
                const html = \`<div class="ping-container">
                    <div class="ping-label" id="label-\${p.id}" style="border-color: \${color}">\${p.msg}</div>
                    <div class="ping-icon" id="icon-\${p.id}">\${iconChar}</div>
                </div>\`;

                if (activePings[p.id]) {
                    // Update existant
                    activePings[p.id].setLatLng([p.lat, p.lng]);
                    const el = activePings[p.id].getElement();
                    if(el) {
                        const lbl = el.querySelector('#label-' + p.id);
                        if(lbl) { lbl.innerText = p.msg; lbl.style.borderColor = color; }
                    }
                } else {
                    // Création
                    const icon = L.divIcon({ 
                        className: 'custom-div-icon', 
                        html: html, 
                        iconSize: [0, 0], 
                        iconAnchor: [0, 0] 
                    });
                    
                    const m = L.marker([p.lat, p.lng], { 
                        icon: icon, 
                        draggable: false, // On gère le drag nous-mêmes
                        autoPan: false,
                        pane: 'pingPane', 
                        interactive: true,
                        zIndexOffset: 1000
                    });
                    
                    m.addTo(map);
                    activePings[p.id] = m;
                    
                    // Setup Events DOM une fois le marker ajouté
                    m.on('add', () => {
                        const el = m.getElement();
                        if(!el) return;
                        
                        // CRUCIAL: Empêche le clic de traverser vers la map (évite de fermer les modales ou de créer un ping par erreur)
                        L.DomEvent.disableClickPropagation(el);
                        L.DomEvent.disableScrollPropagation(el); // Pour éviter le zoom molette accidentel si sur PC, moins utile sur mobile mais bonne pratique

                        const iconEl = el.querySelector('.ping-icon');
                        const labelEl = el.querySelector('.ping-label');

                        // --- LOGIQUE TACTILE ROBUSTE ---
                        
                        if (iconEl) {
                            // Empêcher le menu contextuel natif (copier/coller etc) sur long press
                            iconEl.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); }, false);

                            iconEl.addEventListener('touchstart', (e) => {
                                // On ne stoppe PAS la propagation ici pour laisser la possibilité de scroller la map SI on n'active pas le drag
                                // Mais on capture les coordonnées de départ
                                if (e.touches.length > 0) {
                                    startX = e.touches[0].clientX;
                                    startY = e.touches[0].clientY;
                                }
                                
                                // On lance le timer
                                longPressTimer = setTimeout(() => {
                                    // TIMER ATTEINT -> MODE DRAG ACTIVÉ
                                    isDraggingPing = p.id;
                                    longPressTimer = null;
                                    
                                    // On désactive le pan de la map pour que le doigt ne bouge QUE le ping
                                    map.dragging.disable();
                                    
                                    if(el) {
                                        el.classList.add('ping-dragging');
                                        el.style.zIndex = 9999; // Au dessus de tout
                                    }
                                    
                                    sendToApp({ type: 'PING_LONG_PRESS', id: p.id }); // Haptic feedback côté RN
                                }, 400); // 400ms pour déclencher le drag
                            }, {passive: false});

                            iconEl.addEventListener('touchmove', (e) => {
                                // Si on bouge ALORS que le timer tourne encore (donc pas encore en mode drag)
                                if (longPressTimer && !isDraggingPing) {
                                    const x = e.touches[0].clientX;
                                    const y = e.touches[0].clientY;
                                    
                                    // Si on a bougé de plus de 10 pixels, c'est que l'utilisateur veut scroller la carte, pas draguer le ping
                                    if (Math.abs(x - startX) > 10 || Math.abs(y - startY) > 10) {
                                        clearTimeout(longPressTimer);
                                        longPressTimer = null;
                                        // On laisse l'événement se propager à la map pour qu'elle scrolle
                                    }
                                }
                            }, {passive: true});

                            iconEl.addEventListener('touchend', (e) => {
                                if (longPressTimer) {
                                    // Le timer tournait encore, donc on a relâché AVANT les 400ms -> C'EST UN CLIC SIMPLE
                                    clearTimeout(longPressTimer);
                                    longPressTimer = null;
                                    
                                    // On empêche tout autre comportement
                                    e.preventDefault(); 
                                    e.stopPropagation();
                                    
                                    sendToApp({ type: 'PING_CLICK', id: p.id });
                                }
                            });
                        }
                        
                        // Clic sur Label = Clic simple direct
                        if (labelEl) {
                            const handleLabelClick = (e) => {
                                L.DomEvent.stopPropagation(e);
                                L.DomEvent.preventDefault(e); 
                                sendToApp({ type: 'PING_CLICK', id: p.id });
                            };
                            labelEl.addEventListener('click', handleLabelClick);
                            labelEl.addEventListener('touchend', handleLabelClick); 
                        }
                    });
                }
            });
        }
        
        // --- GESTIONNAIRES GLOBAUX DRAG ---
        // Une fois que isDraggingPing est activé, on écoute tout le document pour ne pas perdre le "focus" si le doigt sort de l'icône
        
        const handleGlobalMove = (e) => {
            if (!isDraggingPing) return;
            
            // On consomme l'événement pour être sûr que rien d'autre ne bouge
            e.preventDefault(); 
            e.stopPropagation();

            let clientX, clientY;
            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }
            
            if (clientX && clientY) {
                // Conversion écran -> LatLng Leaflet
                const point = L.point(clientX, clientY);
                const latlng = map.containerPointToLatLng(point);
                
                const marker = activePings[isDraggingPing];
                if (marker) {
                    // Mise à jour visuelle directe
                    marker.setLatLng(latlng);
                }
            }
        };

        const handleGlobalEnd = (e) => {
            // Nettoyage de sécurité
            if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }

            if (!isDraggingPing) return;
            
            const id = isDraggingPing;
            const marker = activePings[id];
            
            if (marker) {
                const el = marker.getElement();
                if (el) {
                    el.classList.remove('ping-dragging');
                    el.style.zIndex = ''; // Reset z-index
                }
                
                const newPos = marker.getLatLng();
                
                // STOCKAGE OPTIMISTE : On force la position locale pour éviter le saut en arrière
                pendingUpdates[id] = { lat: newPos.lat, lng: newPos.lng };
                setTimeout(() => { if(pendingUpdates[id]) delete pendingUpdates[id]; }, 5000);

                sendToApp({ type: 'PING_MOVE', id: id, lat: newPos.lat, lng: newPos.lng });
            }
            
            isDraggingPing = null;
            // On réactive le drag de la map
            map.dragging.enable();
        };
        
        // Listeners globaux (option passive: false indispensable pour preventDefault sur mobile)
        document.addEventListener('touchmove', handleGlobalMove, {passive: false});
        document.addEventListener('touchend', handleGlobalEnd, {passive: false});
        
        // Support souris pour le dev
        document.addEventListener('mousemove', handleGlobalMove);
        document.addEventListener('mouseup', handleGlobalEnd);

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
  container: { flex: 1, backgroundColor: '#000', height: '100%' },
  loader: { position: 'absolute', top: '50%', left: '50%', transform: [{translateX: -25}, {translateY: -25}] }
});

export default TacticalMap;
