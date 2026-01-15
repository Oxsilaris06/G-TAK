import 'react-native-get-random-values';
import { registerGlobals } from 'react-native-webrtc';

// 1. Enregistre RTCPeerConnection, RTCSessionDescription, etc. dans global
registerGlobals();

// 2. Window & Self
if (typeof window === 'undefined') {
    global.window = global;
}
if (typeof self === 'undefined') {
    global.self = global;
}

// 3. Location (Critique pour PeerJS)
if (!global.window.location) {
    global.window.location = {
        protocol: 'https:',
        host: 'localhost',
        hostname: 'localhost',
        href: 'https://localhost',
        port: '443',
        search: '',
        hash: '',
        pathname: '/',
        origin: 'https://localhost'
    };
}

// 4. Navigator
if (!global.navigator) {
    global.navigator = {};
}
if (!global.navigator.userAgent) {
    global.navigator.userAgent = 'react-native';
}
// Force le mode "Online" pour que PeerJS tente la connexion
if (global.navigator.onLine === undefined) {
    global.navigator.onLine = true;
}

// 5. Process
if (typeof process === 'undefined') {
    global.process = {
        env: { NODE_ENV: __DEV__ ? 'development' : 'production' },
        nextTick: (cb) => setTimeout(cb, 0),
        browser: true
    };
}

// 6. TextEncoder/Decoder (Souvent manquant sur Android Hermes)
if (typeof TextEncoder === 'undefined') {
    global.TextEncoder = class TextEncoder {
        encode(str) {
            if (typeof str !== 'string') str = String(str);
            const arr = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) {
                arr[i] = str.charCodeAt(i) & 255;
            }
            return arr;
        }
    };
}

if (typeof TextDecoder === 'undefined') {
    global.TextDecoder = class TextDecoder {
        decode(arr) {
            return String.fromCharCode.apply(null, arr);
        }
    };
}

// 7. Timers Override
const originalSetTimeout = setTimeout;
global.setTimeout = (fn, ms, ...args) => {
    return originalSetTimeout(fn, ms || 0, ...args);
};

// 8. Crypto Fallback (Dernier recours)
if (typeof crypto === 'undefined') {
    global.crypto = {
        getRandomValues: (arr) => {
             for (let i = 0; i < arr.length; i++) {
                 arr[i] = Math.floor(Math.random() * 256);
             }
             return arr;
        }
    };
}
