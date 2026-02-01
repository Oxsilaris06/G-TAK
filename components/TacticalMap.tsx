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
  maxTrailsPerUser?: number; // Configurable limit
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
        body { margin: 0; padding: 0; background: #000; font-family: sans-serif; transition: filter 0.5s ease; overflow: hidden; }
        #map { width: 100vw; height: 100vh; background: #000; touch-action: none; }
        
        /* Night Ops Mode */
        body.night-ops {
            filter: sepia(100%) hue-rotate(-50deg) saturate(300%) contrast(1.2) brightness(0.8);
        }

        /* Marker Styles */
        .tac-marker-root { position: relative; display: flex; justify-content: center; align-items: center; width: 80px; height: 80px; }
        .tac-cone-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; transition: transform 0.1s linear; pointer-events: none; z-index: 1; }
        .tac-circle-id { position: absolute; z-index: 10; width: 32px; height: 32px; border-radius: 50%; border: 2px solid white; display: flex; justify-content: center; align-items: center; box-shadow: 0 0 5px rgba(0,0,0,0.5); top: 50%; left: 50%; transform: translate(-50%, -50%); transition: all 0.3s ease; }
        .tac-circle-id span { color: white; font-family: monospace; font-size: 10px; font-weight: 900; text-shadow: 0 1px 2px black; }
        
        .leaflet-ping-pane { z-index: 2000 !important; }

        /* Animations */
        @keyframes heartbeat { 0% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 50% { transform: translate(-50%, -50%) scale(1.4); box-shadow: 0 0 20px 10px rgba(239, 68, 68, 0); } 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }
        .tac-marker-heartbeat .tac-circle-id { animation: heartbeat 1.5s infinite ease-in-out !important; border-color: #ef4444 !important; background-color: rgba(239, 68, 68, 0.8) !important; z-index: 9999 !important; }

        /* PING MARKER STYLES - Mobile Friendly Touch Targets */
        .ping-container {
            position: absolute;
            display: flex;
            flex-direction: column;
            align-items: center;
            transform: translate(-50%, -50%); /* Centering */
            cursor: grab;
            /* Important: Allow interaction */
            pointer-events: auto;
            touch-action: none; /* Prevent scroll on drag */
        }
        
        .ping-label { 
            background: rgba(0,0,0,0.85); 
            color: white; 
            padding: 6px 12px;
            border-radius: 6px; 
            font-size: 12px; 
            font-weight: bold; 
            margin-bottom: 4px; 
            border: 1px solid rgba(255,255,255,0.4); 
            white-space: nowrap; 
            max-width: 160px; 
            overflow: hidden; 
            text-overflow: ellipsis;
            box-shadow: 0 2px 4px rgba(0,0,0,0.5);
            /* Action Button style */
            cursor: pointer;
        }

        .ping-icon { 
            font-size: 32px; 
            filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.9)); 
            /* Drag Handle style */
            cursor: grab;
        }

        .ping-dragging {
            opacity: 0.8;
            transform: translate(-50%, -50%) scale(1.1);
            cursor: grabbing;
        }

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
        // --- 1. CONFIGURATION ---
        const map = L.map('map', { 
            zoomControl: false, 
            attributionControl: false, 
            doubleClickZoom: false,
            // Désactiver le "tap" fix legacy qui cause des bugs sur les WebViews modernes
            tap: false,
            // On gère nous-même le drag des markers, donc on laisse le drag de map activé par défaut
            dragging: true 
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

        const esriSat = getLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { ...commonOptions });
        const cartoLabels = getLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', { ...commonOptions, subdomains:'abcd' });

        const layers = {
            dark: getLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { ...commonOptions, subdomains:'abcd' }),
            light: getLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { ...commonOptions, subdomains:'abcd' }),
            satellite: esriSat,
            hybrid: L.layerGroup([
                getLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { ...commonOptions }),
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
        
        // On n'utilise PAS le LayerGroup pour les pings interactifs car on veut un contrôle total sur les événements
        // Les pings seront ajoutés directement à la map
        const activePings = {}; 
        let navLine = null;
        
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
        
        // --- 2. GESTION DU DRAG & DROP CUSTOM (TOUCH API) ---
        // Cette variable globale suit l'état du drag
        let dragTarget = null;

        // Événements globaux pour gérer le mouvement et la fin du drag
        // Cela permet de suivre le doigt même si on sort de la zone du marker
        map.getContainer().addEventListener('touchmove', function(e) {
            if (dragTarget) {
                // Empêcher le scroll de la map
                L.DomEvent.preventDefault(e);
                L.DomEvent.stopPropagation(e);
                
                const touch = e.touches[0];
                const latlng = map.mouseEventToLatLng(touch);
                
                // Mettre à jour la position visuelle du marker immédiatement
                dragTarget.marker.setLatLng(latlng);
                
                // Ajouter une classe pour l'effet visuel
                const el = dragTarget.marker.getElement();
                if (el) el.classList.add('ping-dragging');
            }
        }, { passive: false }); // passive: false est CRUCIAL pour que preventDefault fonctionne

        map.getContainer().addEventListener('touchend', function(e) {
            if (dragTarget) {
                // Fin du drag
                const marker = dragTarget.marker;
                const id = dragTarget.id;
                
                const el = marker.getElement();
                if (el) el.classList.remove('ping-dragging');
                
                // Réactiver la map
                map.dragging.enable();
                
                // Envoyer la nouvelle position finale
                const newPos = marker.getLatLng();
                sendToApp({ type: 'PING_MOVE', id: id, lat: newPos.lat, lng: newPos.lng });
                
                dragTarget = null;
            }
        });

        // --- 3. COMMUNICATION APP ---

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
                updatePings(data.pings, data.showPings); // on retire isHost/callsign car tout le monde a les droits
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
            
            Object.keys(trails).forEach(id => { 
                if(!activeIds.includes(id)) { trails[id].forEach(poly => map.removeLayer(poly)); delete trails[id]; } 
            });

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
                        } else {
                            currentSegment.addLatLng(newPt);
                        }
                        
                        let totalPoints = 0;
                        userSegments.forEach(seg => totalPoints += seg.getLatLngs().length);
                        if (totalPoints > maxTrails) {
                            while (totalPoints > maxTrails && userSegments.length > 0) {
                                const firstSeg = userSegments[0];
                                const pts = firstSeg.getLatLngs();
                                if (pts.length <= (totalPoints - maxTrails)) {
                                    map.removeLayer(firstSeg); userSegments.shift(); totalPoints -= pts.length;
                                } else {
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

        function updatePings(serverPings, showPings) {
            // Nettoyage si on masque les pings
            if (!showPings) { 
                Object.keys(activePings).forEach(id => { map.removeLayer(activePings[id]); delete activePings[id]; });
                return; 
            }
            
            const currentIds = serverPings.map(p => p.id);
            
            // Suppression des pings obsolètes
            Object.keys(activePings).forEach(id => { 
                if(!currentIds.includes(id)) { 
                    map.removeLayer(activePings[id]); 
                    delete activePings[id]; 
                } 
            });
            
            serverPings.forEach(p => {
                // Si on est en train de drag ce ping, on ignore les updates serveur pour éviter le "flickering"
                if (dragTarget && dragTarget.id === p.id) return;

                const iconChar = (p.type === 'HOSTILE') ? '🔴' : (p.type === 'FRIEND') ? '🔵' : '👁️';
                const color = (p.type === 'HOSTILE') ? '#ef4444' : (p.type === 'FRIEND') ? '#22c55e' : '#eab308';
                
                const html = \`<div class="ping-container"><div class="ping-label" id="label-\${p.id}" style="border-color: \${color}">\${p.msg}</div><div class="ping-icon" id="icon-\${p.id}">\${iconChar}</div></div>\`;

                if (activePings[p.id]) {
                    // Update
                    activePings[p.id].setLatLng([p.lat, p.lng]);
                    const icon = activePings[p.id].options.icon;
                    // On ne recrée pas l'icône si le contenu n'a pas changé pour éviter de casser les event listeners
                    // Mais ici on utilise DivIcon, on peut mettre à jour le HTML
                    // Cependant, pour la sécurité des events, mieux vaut ne rien faire si texte inchangé.
                    // Pour simplifier, on force la mise à jour visuelle :
                    const el = activePings[p.id].getElement();
                    if(el) {
                        // Attention: innerHTML remplace les éléments, il faudrait réattacher les events si on faisait ça.
                        // Solution: on utilise les IDs uniques pour cibler Label et Icone
                        const labelEl = el.querySelector('#label-' + p.id);
                        if(labelEl) {
                             labelEl.innerText = p.msg;
                             labelEl.style.borderColor = color;
                        }
                    }
                } else {
                    // Create New Marker
                    const icon = L.divIcon({ className: 'custom-div-icon', html: html, iconSize: [100, 80], iconAnchor: [50, 60] });
                    
                    // On n'utilise PAS draggable:true de Leaflet. On gère tout à la main.
                    const m = L.marker([p.lat, p.lng], { 
                        icon: icon, 
                        pane: 'pingPane',
                        interactive: true // Important pour recevoir les events
                    });
                    
                    m.addTo(map);
                    activePings[p.id] = m;

                    // --- ATTACHEMENT DES ÉVÉNEMENTS MANUELS ROBUSTES ---
                    const el = m.getElement();
                    if(el) {
                        const iconEl = el.querySelector('.ping-icon');
                        const labelEl = el.querySelector('.ping-label');

                        // GESTION DU DRAG (sur l'icône)
                        if (iconEl) {
                            iconEl.addEventListener('touchstart', function(e) {
                                // Début du drag
                                L.DomEvent.stopPropagation(e); // Pas de clic map
                                L.DomEvent.preventDefault(e);  // Pas de scroll
                                
                                map.dragging.disable(); // Bloque la map
                                dragTarget = { id: p.id, marker: m }; // Enregistre l'état global
                            }, { passive: false });

                            // Fallback Souris pour dev PC
                            iconEl.addEventListener('mousedown', function(e) {
                                L.DomEvent.stopPropagation(e);
                                map.dragging.disable();
                                dragTarget = { id: p.id, marker: m };
                            });
                        }

                        // GESTION DU CLIC (sur le label)
                        if (labelEl) {
                            // On utilise touchend pour simuler un click "tap" réactif
                            labelEl.addEventListener('touchend', function(e) {
                                // Si on n'était pas en train de draguer
                                if (!dragTarget) {
                                    L.DomEvent.stopPropagation(e);
                                    sendToApp({ type: 'PING_CLICK', id: p.id });
                                }
                            });
                            
                            // Fallback click souris
                            labelEl.addEventListener('click', function(e) {
                                L.DomEvent.stopPropagation(e);
                                sendToApp({ type: 'PING_CLICK', id: p.id });
                            });
                        }
                    }
                }
            });
        }
        
        // --- GESTION GLOBALE DE LA FIN DE DRAG (SOURIS) ---
        // Pour le tactile, c'est géré par le listener 'touchend' sur le container map plus haut
        map.on('mouseup', function() {
             if (dragTarget) {
                map.dragging.enable();
                const marker = dragTarget.marker;
                const newPos = marker.getLatLng();
                sendToApp({ type: 'PING_MOVE', id: dragTarget.id, lat: newPos.lat, lng: newPos.lng });
                dragTarget = null;
            }
        });
        
        map.on('mousemove', function(e) {
            if (dragTarget) {
                dragTarget.marker.setLatLng(e.latlng);
            }
        });

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
  container: { flex: 1, backgroundColor: '#000' },
  loader: { position: 'absolute', top: '50%', left: '50%', transform: [{translateX: -25}, {translateY: -25}] }
});

export default TacticalMap;
