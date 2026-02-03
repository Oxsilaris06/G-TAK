/**
 * Service de Stockage Chiffré - MMKV
 * Remplace AsyncStorage avec une solution native haute performance
 * 
 * Avantages:
 * - 100x plus rapide qu'AsyncStorage
 * - Chiffrement AES-256 optionnel
 * - Stockage binaire efficace
 * - Pas de limite de taille (contrairement à AsyncStorage ~6MB)
 */

import { MMKV } from 'react-native-mmkv';

// Clé de chiffrement pour le stockage sécurisé (peut être récupérée d'un Keychain sécurisé)
const ENCRYPTION_KEY = 'praxis-secure-storage-key-v1';

// Instance MMKV principale avec chiffrement
export const storage = new MMKV({
  id: 'praxis-secure-storage',
  encryptionKey: ENCRYPTION_KEY,
});

// Instance MMKV pour les données non sensibles (performance maximale)
export const storageFast = new MMKV({
  id: 'praxis-fast-storage',
});

// Instance MMKV pour les logs et cache temporaire
export const storageCache = new MMKV({
  id: 'praxis-cache-storage',
});

/**
 * Wrapper type-safe pour le stockage
 */
export const mmkvStorage = {
  /**
   * Stocke une valeur string
   */
  set: (key: string, value: string, encrypted: boolean = true): void => {
    const store = encrypted ? storage : storageFast;
    store.set(key, value);
  },

  /**
   * Stocke un objet JSON
   */
  setObject: <T>(key: string, value: T, encrypted: boolean = true): void => {
    const store = encrypted ? storage : storageFast;
    try {
      store.set(key, JSON.stringify(value));
    } catch (e) {
      console.error('[MMKV] Error saving object:', e);
    }
  },

  /**
   * Récupère une string
   */
  getString: (key: string, encrypted: boolean = true): string | undefined => {
    const store = encrypted ? storage : storageFast;
    return store.getString(key);
  },

  /**
   * Récupère un nombre
   */
  getNumber: (key: string, encrypted: boolean = true): number | undefined => {
    const store = encrypted ? storage : storageFast;
    return store.getNumber(key);
  },

  /**
   * Récupère un booléen
   */
  getBoolean: (key: string, encrypted: boolean = true): boolean | undefined => {
    const store = encrypted ? storage : storageFast;
    return store.getBoolean(key);
  },

  /**
   * Récupère un objet JSON
   */
  getObject: <T>(key: string, encrypted: boolean = true): T | null => {
    const store = encrypted ? storage : storageFast;
    try {
      const json = store.getString(key);
      return json ? JSON.parse(json) : null;
    } catch (e) {
      console.error('[MMKV] Error parsing object:', e);
      return null;
    }
  },

  /**
   * Supprime une clé
   */
  delete: (key: string, encrypted: boolean = true): void => {
    const store = encrypted ? storage : storageFast;
    store.delete(key);
  },

  /**
   * Vérifie si une clé existe
   */
  contains: (key: string, encrypted: boolean = true): boolean => {
    const store = encrypted ? storage : storageFast;
    return store.contains(key);
  },

  /**
   * Récupère toutes les clés
   */
  getAllKeys: (encrypted: boolean = true): string[] => {
    const store = encrypted ? storage : storageFast;
    return store.getAllKeys();
  },

  /**
   * Efface tout le stockage
   */
  clearAll: (encrypted: boolean = true): void => {
    const store = encrypted ? storage : storageFast;
    store.clearAll();
  },

  /**
   * Cache temporaire - set
   */
  setCache: (key: string, value: string, ttlMs: number = 300000): void => {
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
  },

  /**
   * Migration depuis AsyncStorage (à exécuter une fois au démarrage)
   */
  migrateFromAsyncStorage: async (asyncStorage: any): Promise<void> => {
    try {
      const keys = await asyncStorage.getAllKeys();
      for (const key of keys) {
        const value = await asyncStorage.getItem(key);
        if (value !== null) {
          storage.set(key, value);
        }
      }
      console.log('[MMKV] Migration from AsyncStorage completed');
    } catch (e) {
      console.error('[MMKV] Migration error:', e);
    }
  },
};

// Compatibilité avec l'API AsyncStorage pour migration facile
export const mmkvAsyncStorageCompat = {
  setItem: (key: string, value: string): Promise<void> => {
    mmkvStorage.set(key, value);
    return Promise.resolve();
  },
  getItem: (key: string): Promise<string | null> => {
    return Promise.resolve(mmkvStorage.getString(key) ?? null);
  },
  removeItem: (key: string): Promise<void> => {
    mmkvStorage.delete(key);
    return Promise.resolve();
  },
  getAllKeys: (): Promise<string[]> => {
    return Promise.resolve(mmkvStorage.getAllKeys());
  },
  multiGet: (keys: string[]): Promise<[string, string | null][]> => {
    const result = keys.map((key): [string, string | null] => [
      key,
      mmkvStorage.getString(key) ?? null,
    ]);
    return Promise.resolve(result);
  },
  multiSet: (keyValues: [string, string][]): Promise<void> => {
    keyValues.forEach(([key, value]) => {
      mmkvStorage.set(key, value);
    });
    return Promise.resolve();
  },
  multiRemove: (keys: string[]): Promise<void> => {
    keys.forEach((key) => mmkvStorage.delete(key));
    return Promise.resolve();
  },
};

export default mmkvStorage;
