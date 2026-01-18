// 1. Crypto & Encodage (DOIT ÊTRE EN PREMIER ABSOLU)
import 'react-native-get-random-values';
import 'fast-text-encoding'; // Installe TextEncoder/TextDecoder sur global automatiquement

// Fallback Crypto si le module natif échoue (rare mais possible)
if (typeof crypto === 'undefined') {
    global.crypto = {
        getRandomValues: (arr) => {
            console.warn("[Polyfill] Using insecure Math.random fallback for crypto");
            for (let i = 0; i < arr.length; i++) {
                arr[i] = Math.floor(Math.random() * 256);
            }
            return arr;
        }
    };
}

// 2. WebRTC Globals
try {
    const { registerGlobals } = require('react-native-webrtc');
    registerGlobals();
} catch (e) {
    console.error("[Polyfills] Failed to register WebRTC globals", e);
}

// 3. Window & Self (Compatibilité PeerJS)
if (typeof window === 'undefined') { global.window = global; }
if (typeof self === 'undefined') { global.self = global; }

// 4. Location Mock (CRITIQUE: Doit être HTTPS pour que PeerJS active le mode secure)
if (!global.window.location) {
    global.window.location = {
        protocol: 'https:', 
        host: 'tacsuite.app', 
        hostname: 'tacsuite.app',
        href: 'https://tacsuite.app', 
        port: '443', 
        search: '', 
        hash: '', 
        pathname: '/', 
        origin: 'https://tacsuite.app',
        ancestorOrigins: []
    };
}

// 5. Navigator
if (!global.navigator) { global.navigator = {}; }
if (!global.navigator.userAgent) { global.navigator.userAgent = 'react-native'; }
if (global.navigator.onLine === undefined) { global.navigator.onLine = true; }

// 6. Timer Fix (Évite les warnings de long timers sur Android)
// PeerJS utilise parfois des timers longs pour le heartbeat
const _setTimeout = global.setTimeout;
const _setInterval = global.setInterval;
