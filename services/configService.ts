import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings, DEFAULT_SETTINGS } from '../types';
import { CONFIG } from '../constants';

const CONFIG_KEY = 'TacSuite_Settings_v1';

class ConfigService {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private listeners: ((settings: AppSettings) => void)[] = [];

  async init() {
    try {
      const json = await AsyncStorage.getItem(CONFIG_KEY);
      if (json) {
        const loaded = JSON.parse(json);
        this.settings = { ...DEFAULT_SETTINGS, ...loaded };
        
        // Sécurité pour la liste de messages
        if (!this.settings.quickMessages || !Array.isArray(this.settings.quickMessages) || this.settings.quickMessages.length === 0) {
             this.settings.quickMessages = DEFAULT_SETTINGS.quickMessages;
        }
      }

      // Récupération legacy du trigramme si présent
      const legacyTrigram = await AsyncStorage.getItem(CONFIG.TRIGRAM_STORAGE_KEY);
      if (legacyTrigram && this.settings.username === DEFAULT_SETTINGS.username) {
          this.settings.username = legacyTrigram;
      }
    } catch (e) {
      console.warn("Erreur chargement config", e);
    }
    return this.settings;
  }

  get() { return this.settings; }

  async update(newSettings: Partial<AppSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    
    // Synchro avec le stockage legacy du trigramme
    if (newSettings.username) {
        try {
            await AsyncStorage.setItem(CONFIG.TRIGRAM_STORAGE_KEY, newSettings.username);
        } catch (e) {}
    }

    this.notify();
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.settings));
  }

  subscribe(cb: (s: AppSettings) => void) {
    this.listeners.push(cb);
    cb(this.settings);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private notify() { this.listeners.forEach(cb => cb(this.settings)); }
}

export const configService = new ConfigService();
