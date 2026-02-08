/**
 * Service de Stockage Chiffré - MMKV
 * Remplace AsyncStorage avec une solution native haute performance
 */

import { MMKV } from 'react-native-mmkv';

// Instances MMKV (initialement nulles en attente du Secure Boot)
let storage: MMKV | null = null;
let storageFast: MMKV | null = null;
let storageCache: MMKV | null = null;

let isInitialized = false;

/**
 * Wrapper type-safe pour le stockage
 */
export const mmkvStorage = {
  /**
   * Initialise le stockage avec la clé dérivée de l'utilisateur
   */
  init: (encryptionKey: string) => {
    if (isInitialized) return;

    try {
      console.log('[MMKV] Initializing Secure Storage...');
      storage = new MMKV({
        id: 'praxis-secure-storage',
        encryptionKey: encryptionKey,
      });

      storageFast = new MMKV({
        id: 'praxis-fast-storage',
        encryptionKey: encryptionKey
      });

      storageCache = new MMKV({
        id: 'praxis-cache-storage',
        encryptionKey: encryptionKey
      });

      isInitialized = true;
      console.log('[MMKV] Storage initialized successfully.');
    } catch (e) {
      console.error('[MMKV] Init Failed! Key might be wrong.', e);
      throw e; // Propagate error to UI (ask user to retry pass)
    }
  },

  isReady: () => isInitialized,

  /**
   * Stocke une valeur string
   */
  set: (key: string, value: string, encrypted: boolean = true): void => {
    if (!storage || !storageFast) return;
    const store = encrypted ? storage : storageFast;
    store.set(key, value);
  },

  /**
   * Stocke un objet JSON
   */
  setObject: <T>(key: string, value: T, encrypted: boolean = true): void => {
    if (!storage || !storageFast) return;
    const store = encrypted ? storage : storageFast;
    try {
      const json = JSON.stringify(value);
      store.set(key, json);
    } catch (e) {
      console.error(`[MMKV] SetObject Error (${key}):`, e);
    }
  },

  /**
   * Récupère une valeur string
   */
  getString: (key: string, encrypted: boolean = true): string | undefined => {
    if (!storage || !storageFast) return undefined;
    const store = encrypted ? storage : storageFast;
    return store.getString(key);
  },

  /**
   * Récupère un nombre
   */
  getNumber: (key: string, encrypted: boolean = true): number | undefined => {
    if (!storage || !storageFast) return undefined;
    const store = encrypted ? storage : storageFast;
    return store.getNumber(key);
  },

  /**
   * Récupère un booléen
   */
  getBoolean: (key: string, encrypted: boolean = true): boolean | undefined => {
    if (!storage || !storageFast) return undefined;
    const store = encrypted ? storage : storageFast;
    return store.getBoolean(key);
  },

  /**
   * Récupère un objet JSON
   */
  getObject: <T>(key: string, encrypted: boolean = true): T | null => {
    if (!storage || !storageFast) return null;
    const store = encrypted ? storage : storageFast;
    try {
      const json = store.getString(key);
      if (json) {
        return JSON.parse(json) as T;
      }
      return null;
    } catch (e) {
      console.error(`[MMKV] GetObject Error (${key}):`, e);
      return null;
    }
  },

  /**
   * Supprime une clé
   */
  delete: (key: string, encrypted: boolean = true): void => {
    if (!storage || !storageFast) return;
    const store = encrypted ? storage : storageFast;
    store.delete(key);
  },

  /**
 * Vérifie si une clé existe
 */
  contains: (key: string, encrypted: boolean = true): boolean => {
    if (!storage || !storageFast) return false;
    const store = encrypted ? storage : storageFast;
    return store.contains(key);
  },

  /**
   * Récupère toutes les clés
   */
  getAllKeys: (encrypted: boolean = true): string[] => {
    if (!storage || !storageFast) return [];
    const store = encrypted ? storage : storageFast;
    return store.getAllKeys();
  },

  /**
   * Efface tout le stockage
   */
  clearAll: (encrypted: boolean = true): void => {
    if (!storage || !storageFast) return;
    const store = encrypted ? storage : storageFast;
    store.clearAll();
  },

  /**
   * Cache temporaire - set
   */
  setCache: (key: string, value: string, ttlMs: number = 300000): void => {
    if (!storageCache) return;
    const data = {
      value,
      expires: Date.now() + ttlMs,
    };
    storageCache.set(key, JSON.stringify(data));
  },

  /**
   * Cache temporaire - get
   */
  getCache: (key: string): string | null => {
    if (!storageCache) return null;
    try {
      const json = storageCache.getString(key);
      if (!json) return null;
      const data = JSON.parse(json);
      if (Date.now() > data.expires) {
        storageCache.delete(key);
        return null;
      }
      return data.value;
    } catch {
      return null;
    }
  }
};

/**
 * Adaptateur pour Zustand Persist
 */
export const mmkvAsyncStorageCompat = {
  getItem: async (name: string): Promise<string | null> => {
    return mmkvStorage.getString(name) || null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    mmkvStorage.set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    mmkvStorage.delete(name);
  },
};

export default mmkvStorage;
