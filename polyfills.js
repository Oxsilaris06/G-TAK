import 'react-native-get-random-values';

// 1. GLOBAL ENVIRONMENT SETUP
if (typeof window === 'undefined') {
    global.window = global;
}

if (typeof self === 'undefined') {
    global.self = global;
}

if (typeof process === 'undefined') {
    global.process = {
        env: { NODE_ENV: __DEV__ ? 'development' : 'production' },
        version: '',
        nextTick: (cb) => setTimeout(cb, 0),
        browser: true,
        platform: 'linux' 
    };
}

// 2. NAVIGATOR POLYFILL (Fix PeerJS browser check)
if (!global.navigator) {
    global.navigator = {
        userAgent: 'react-native',
        product: 'ReactNative',
        platform: 'Linux armv81',
        appVersion: '1.0.0',
        onLine: true,
    };
} else {
    global.navigator.userAgent = 'react-native';
    if(global.navigator.onLine === undefined) global.navigator.onLine = true;
}

// 3. LOCATION POLYFILL (Fix PeerJS location check)
if (!global.location) {
    global.location = {
        href: 'http://localhost/',
        protocol: 'http:',
        host: 'localhost',
        hostname: 'localhost',
        port: '80',
        pathname: '/',
        search: '',
        hash: '',
        origin: 'http://localhost'
    };
}

// 4. TEXT ENCODER / DECODER (Fix Hermes)
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

// 5. TIMERS OVERRIDE
const originalSetTimeout = setTimeout;
global.setTimeout = (fn, ms, ...args) => {
    return originalSetTimeout(fn, ms || 0, ...args);
};

// 6. CRYPTO FALLBACK (Sécurité supplémentaire)
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
