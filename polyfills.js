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

// 2. NAVIGATOR POLYFILL
if (!global.navigator) {
    global.navigator = {
        userAgent: 'react-native',
        product: 'ReactNative',
        platform: 'Linux armv81',
        appVersion: '1.0.0',
        onLine: true,
    };
} else {
    // Merge existing properties safely
    if (!global.navigator.userAgent) global.navigator.userAgent = 'react-native';
    if (global.navigator.onLine === undefined) global.navigator.onLine = true;
}

// 3. LOCATION POLYFILL
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

// 4. TEXT ENCODER / DECODER
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

// 5. TIMERS & PERFORMANCE
const originalSetTimeout = setTimeout;
global.setTimeout = (fn, ms, ...args) => {
    return originalSetTimeout(fn, ms || 0, ...args);
};

if (typeof performance === 'undefined') {
    global.performance = {
        now: () => Date.now()
    };
}

// 6. CRYPTO FALLBACK (Minimal)
if (typeof crypto === 'undefined') {
    global.crypto = {
        getRandomValues: (arr) => {
             // Fallback uniquement si react-native-get-random-values échoue
             for (let i = 0; i < arr.length; i++) {
                 arr[i] = Math.floor(Math.random() * 256);
             }
             return arr;
        }
    };
}
