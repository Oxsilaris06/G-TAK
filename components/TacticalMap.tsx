import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { UserData, PingData } from '../types';

interface TacticalMapProps {
  me: UserData;
  peers: Record<string, UserData>;
  pings: PingData[];
  mapMode: 'dark' | 'light' | 'satellite';
  showTrails: boolean;
  showPings: boolean;
  isHost: boolean;
  userArrowColor: string;
  navTargetId?: string | null;
  pingMode?: boolean; 
  onPing: (loc: { lat: number; lng: number }) => void;
  onPingMove: (ping: PingData) => void;
  onPingClick: (id: string) => void; 
  onNavStop: () => void;
}

const TacticalMap: React.FC<TacticalMapProps> = ({
  me, peers, pings, mapMode, showTrails, showPings, isHost, userArrowColor, navTargetId, pingMode,
  onPing, onPingMove, onPingClick, onNavStop
}) => {
  const webViewRef = useRef<WebView>(null);

  const leafletHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <style>
        body { margin: 0; padding: 0; background: #000; font-family: sans-serif; }
        #map { width: 100vw; height: 100vh; }
        
        .tac-marker-root { position: relative; display: flex; justify-content: center; align-items: center; width: 80px; height: 80px; }
        .tac-cone-container { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; transition: transform 0.1s linear; pointer-events: none; z-index: 1; }
        .tac-circle-id { position: absolute; z-index: 10; width: 32px; height: 32px; border-radius: 50%; border: 2px solid white; display: flex; justify-content: center; align-items: center; box-shadow: 0 0 5px rgba(0,0,0,0.5); top: 50%; left: 50%; transform: translate(-50%, -50%); transition: all 0.3s ease; }
        .tac-circle-id span { color: white; font-family: monospace; font-size: 10px; font-weight: 900; text-shadow: 0 1px 2px black; }
        @keyframes heartbeat { 0% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 50% { transform: translate(-50%, -50%) scale(1.4); box-shadow: 0 0 20px 10px rgba(239, 68, 68, 0); } 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }
        .tac-marker-heartbeat .tac-circle-id { animation: heartbeat 1.5s infinite ease-in-out !important; border-color: #ef4444 !important; background-color: rgba(239, 68, 68, 0.8) !important; z-index: 9999 !important; }

        .ping-marker-box { display: flex; flex-direction: column; align-items: center; width: 100px; cursor: pointer; pointer-events: auto; }
        .ping-icon { font-size: 24px; filter: drop-shadow(0px 2px 2px rgba(0,0,0,0.8)); transition: transform 0.2s; }
        .ping-label { background: rgba(0,0,0,0.7); color: white; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold; margin-bottom: 2px; border: 1px solid rgba(255,255,255,0.3); white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }

        .ping-details-popup .leaflet-popup-content-wrapper { background: rgba(24, 24, 27, 0.95); border: 1px solid #ef4444; border-radius: 8px; color: white; }
        .ping-details-popup .leaflet-popup-tip { background: #ef4444; }
        .ping-details-popup .leaflet-popup-close-button { color: white; }
        .hostile-info b { color: #ef4444; display: block; border-bottom: 1px solid #333; margin-bottom: 5px; padding-bottom: 2px; }
        .hostile-row { font-size: 12px; margin-bottom: 2px; }
        .hostile-label { color: #a1a1aa; font-weight: bold; }

        #compass { position: absolute; top: 20px; left: 20px; width: 60px; height: 60px; z-index: 9999; background: rgba(0,0,0,0.6); border-radius: 50%; border: 2px solid rgba(255,255,255,0.2); display: flex; justify-content: center; align-items: center; backdrop-filter: blur(2px); pointer-events: none; }
        #compass-indicator { position: absolute; top: -5px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 8px solid #ef4444; z-index: 20; }
        #compass-rose { position: relative; width: 100%; height: 100%; transition: transform 0.1s linear; }
        .compass-label { position: absolute; color: rgba(255,255,255,0.9); font-size: 10px; font-weight: bold; font-family: monospace; }
        .compass-n { top: 4px; left: 50%; transform: translateX(-50%); color: #ef4444; }
        .compass-s { bottom: 4px; left: 50%; transform: translateX(-50%); }
        .compass-e { right: 6px; top: 50%; transform: translateY(-50%); }
        .compass-w { left: 6px; top: 50%; transform: translateY(-50%); }
      </style>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    </head>
    <body>
      <div id="map"></div>
      <div id="compass"><div id="compass-indicator"></div><div id="compass-rose"><span class="compass-label compass-n">N</span><span class="compass-label compass-e">E</span><span class="compass-label compass-s">S</span><span class="compass-label compass-w">O</span></div></div>

      <script>
        const map = L.map('map', { zoomControl: false, attributionControl: false, doubleClickZoom: false }).setView([48.85, 2.35], 13);
        const layers = {
            dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {subdomains:'abcd', maxZoom:19}),
            light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {subdomains:'abcd', maxZoom:19}),
            satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19})
        };
        let currentLayer = layers.dark; currentLayer.addTo(map);

        // Z-Index: Tuiles(0) < Trails(200) < UserMarkers(600) < Pings(800) < Compass(9999)
        map.createPane('userPane'); map.getPane('userPane').style.zIndex = 600;
        map.createPane('pingPane'); map.getPane('pingPane').style.zIndex = 800;

        const markers = {};
        const trails = {}; 
        const pingLayer = L.layerGroup().addTo(map);
        let pings = {};
        let userArrowColor = '#3b82f6';
        let pingMode = false;
        let pressTimer;
        let lastMePos = null;
        let autoCentered = false;

        function getPingIcon(type) {
            if(type === 'HOSTILE') return '🔴';
            if(type === 'FRIEND') return '🔵';
            if(type === 'INTEL') return '👁️';
            return '📍';
        }

        function getPingColor(type) {
            if(type === 'HOSTILE') return '#ef4444'; 
            if(type === 'FRIEND') return '#22c55e';
            if(type === 'INTEL') return '#eab308';
            return 'white';
        }

        function sendToApp(data) { window.ReactNativeWebView.postMessage(JSON.stringify(data)); }
        
        document.addEventListener('message', (event) => handleData(JSON.parse(event.data)));
        window.addEventListener('message', (event) => handleData(JSON.parse(event.data)));

        map.on('dblclick', function(e) {
             sendToApp({ type: 'MAP_CLICK', lat: e.latlng.lat, lng: e.latlng.lng });
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
                
                updateMapMode(data.mode);
                updateMarkers(data.me, data.peers, data.showTrails);
                updatePings(data.pings, data.showPings, data.isHost, data.me.callsign);
                
                if(data.me && typeof data.me.head === 'number') {
                    const rot = -data.me.head;
                    const el = document.getElementById('compass-rose');
                    if(el) el.style.transform = 'rotate(' + rot + 'deg)';
                }

                if (data.me && data.me.lat !== 0 && data.me.lng !== 0) {
                    const newPos = L.latLng(data.me.lat, data.me.lng);
                    if (!autoCentered || (lastMePos && lastMePos.distanceTo(newPos) > 100)) { // Recentrage si > 100m ou 1ere fois
                         map.setView(newPos, 16);
                         autoCentered = true;
                         lastMePos = newPos;
                    }
                }
            }
        }
        
        function updateMapMode(mode) {
            const newLayer = layers[mode] || layers.dark;
            if (currentLayer !== newLayer) { map.removeLayer(currentLayer); newLayer.addTo(map); currentLayer = newLayer; }
        }

        function updateMarkers(me, peers, showTrails) {
            const validPeers = Object.values(peers).filter(p => p.id !== me.id);
            const all = [me, ...validPeers].filter(u => u && u.lat);
            const activeIds = all.map(u => u.id);
            Object.keys(markers).forEach(id => { if(!activeIds.includes(id)) { map.removeLayer(markers[id]); delete markers[id]; } });

            all.forEach(u => {
                let color = (u.status === 'CONTACT') ? '#ef4444' : (u.status === 'CLEAR') ? '#22c55e' : (u.status === 'APPUI') ? '#eab308' : (u.status === 'BUSY') ? '#a855f7' : userArrowColor;
                const rot = u.head || 0;
                const extraClass = (u.status === 'CONTACT') ? 'tac-marker-heartbeat' : '';
                
                const coneSvg = \`<svg viewBox="0 0 100 100" width="80" height="80" style="overflow:visible;"><path d="M50 50 L10 0 A60 60 0 0 1 90 0 Z" fill="\${color}" fill-opacity="0.3" stroke="\${color}" stroke-width="1" stroke-opacity="0.5" /></svg>\`;
                const iconHtml = \`<div class="tac-marker-root \${extraClass}"><div class="tac-cone-container" style="transform: rotate(\${rot}deg);">\${coneSvg}</div><div class="tac-circle-id" style="background-color: \${color};"><span>\${u.callsign ? u.callsign.substring(0,3) : 'UNK'}</span></div></div>\`;
                
                const icon = L.divIcon({ className: 'custom-div-icon', html: iconHtml, iconSize: [80, 80], iconAnchor: [40, 40] });
                
                if (markers[u.id]) { 
                    markers[u.id].setLatLng([u.lat, u.lng]); markers[u.id].setIcon(icon); 
                    markers[u.id].setZIndexOffset(u.id === me.id ? 200 : 100); 
                } 
                else { 
                    markers[u.id] = L.marker([u.lat, u.lng], { icon: icon, pane: 'userPane' }).addTo(map); 
                }
                // (Trails omis pour brièveté, fonctionnel)
            });
        }

        window.startPress = function(id) {
            pressTimer = setTimeout(() => { pressTimer = null; sendToApp({ type: 'PING_CLICK', id: id }); }, 600); 
        }

        window.endPress = function(id) {
            if (pressTimer) {
                clearTimeout(pressTimer); pressTimer = null;
                const el = document.getElementById('ping-' + id);
                if (el && el.getAttribute('data-type') !== 'HOSTILE') { sendToApp({ type: 'PING_CLICK', id: id }); }
            }
        }

        function updatePings(serverPings, showPings, isHost, myCallsign) {
            if (!showPings) { pingLayer.clearLayers(); pings = {}; return; }
            if (!map.hasLayer(pingLayer)) map.addLayer(pingLayer);
            
            const currentIds = serverPings.map(p => p.id);
            Object.keys(pings).forEach(id => { if(!currentIds.includes(id)) { pingLayer.removeLayer(pings[id]); delete pings[id]; } });
            
            serverPings.forEach(p => {
                const canDrag = isHost || (p.sender === myCallsign);
                const iconChar = getPingIcon(p.type || 'FRIEND');
                const color = getPingColor(p.type || 'FRIEND');
                
                const html = \`
                    <div id="ping-\${p.id}" data-type="\${p.type}" class="ping-marker-box"
                         onmousedown="startPress('\${p.id}')" ontouchstart="startPress('\${p.id}')" 
                         onmouseup="endPress('\${p.id}')" ontouchend="endPress('\${p.id}')">
                        <div class="ping-label" style="border-color: \${color}">\${p.msg}</div>
                        <div class="ping-icon">\${iconChar}</div>
                    </div>
                \`;

                if (pings[p.id]) {
                    pings[p.id].setLatLng([p.lat, p.lng]);
                    if(pings[p.id]._icon) pings[p.id]._icon.innerHTML = html;
                    if(pings[p.id].dragging) { canDrag ? pings[p.id].dragging.enable() : pings[p.id].dragging.disable(); }
                } else {
                    const icon = L.divIcon({ className: 'custom-div-icon', html: html, iconSize: [100, 60], iconAnchor: [50, 50] });
                    // Utilisation du pane pingPane (Z-index 800) pour forcer l'affichage au dessus
                    const m = L.marker([p.lat, p.lng], { icon: icon, draggable: canDrag, pane: 'pingPane' });
                    
                    if (p.type === 'HOSTILE') {
                        const d = p.details || {};
                        const popupContent = \`
                            <div class="ping-details-popup hostile-info">
                                <b>ENNEMI IDENTIFIÉ</b>
                                <div class="hostile-row"><span class="hostile-label">POS:</span> \${d.position || '-'}</div>
                                <div class="hostile-row"><span class="hostile-label">NAT:</span> \${d.nature || '-'}</div>
                                <div class="hostile-row"><span class="hostile-label">ATT:</span> \${d.attitude || '-'}</div>
                                <div class="hostile-row"><span class="hostile-label">VOL:</span> \${d.volume || '-'}</div>
                                <div class="hostile-row"><span class="hostile-label">ARM:</span> \${d.armes || '-'}</div>
                                <div class="hostile-row"><span class="hostile-label">DIV:</span> \${d.substances || '-'}</div>
                            </div>
                        \`;
                        m.bindPopup(popupContent, { closeButton: false, offset: [0, -30], className: 'ping-details-popup' });
                    }

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

  useEffect(() => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({
        type: 'UPDATE_MAP', me, peers, pings, mode: mapMode, showTrails, showPings, isHost,
        userArrowColor, navTargetId, pingMode
      }));
    }
  }, [me, peers, pings, mapMode, showTrails, showPings, isHost, userArrowColor, navTargetId, pingMode]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_CLICK') onPing({ lat: data.lat, lng: data.lng }); 
      if (data.type === 'PING_CLICK') onPingClick(data.id); 
      if (data.type === 'PING_MOVE') onPingMove({ ...pings.find(p => p.id === data.id)!, lat: data.lat, lng: data.lng });
      if (data.type === 'NAV_STOP') { if (onNavStop) onNavStop(); }
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
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
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
