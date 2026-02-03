import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings, DEFAULT_SETTINGS } from '../types';
import { CONFIG } from '../constants';
import { locationService } from './locationService';

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
        
        // Sécurité pour la liste de messages et maxTrails
        if (!this.settings.quickMessages || !Array.isArray(this.settings.quickMessages)) {
              this.settings.quickMessages = DEFAULT_SETTINGS.quickMessages;
        }
        if (!this.settings.maxTrailsPerUser) {
            this.settings.maxTrailsPerUser = 500;
        }
      }

      // Récupération legacy du trigramme si présent
      const legacyTrigram = await AsyncStorage.getItem(CONFIG.TRIGRAM_STORAGE_KEY);
      if (legacyTrigram && this.settings.username === DEFAULT_SETTINGS.username) {
          this.settings.username = legacyTrigram;
      }

      // Application initiale
      this.applyLocationSettings(this.settings);

    } catch (e) {
      console.warn("Erreur chargement config", e);
    }
    return this.settings;
  }

  get() { return this.settings; }

  async update(newSettings: Partial<AppSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    
    if (newSettings.username) {
        try {
            await AsyncStorage.setItem(CONFIG.TRIGRAM_STORAGE_KEY, newSettings.username);
        } catch (e) {}
    }

    // Mise à jour dynamique du service GPS
    if (newSettings.gpsUpdateInterval !== undefined) {
        this.applyLocationSettings(this.settings);
    }

    this.notify();
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.settings));
  }

  private applyLocationSettings(s: AppSettings) {
      const interval = s.gpsUpdateInterval || 5000;
      
      // Configuration du Service Foreground (Notification)
      // On le fait ici pour éviter de le faire clignoter dans App.tsx
      const foregroundOptions = {
          notificationTitle: "PRAXIS ACTIF",
          notificationBody: "Lien Tactique Maintenu",
          notificationColor: "#000000" // Fond noir demandé
      };

      // Mode Assaut (< 2s) vs Mode Patrouille
      if (interval < 2000) {
          locationService.updateOptions({
              accuracy: 6, // BestForNavigation
              distanceInterval: 0,
              timeInterval: interval,
              deferredUpdatesInterval: interval,
              foregroundService: foregroundOptions
          });
      } else {
          locationService.updateOptions({
              accuracy: 4, // High
              distanceInterval: 5, // Un peu de filtrage
              timeInterval: interval,
              deferredUpdatesInterval: interval,
              foregroundService: foregroundOptions
          });
      }
  }

  subscribe(cb: (s: AppSettings) => void) {
    this.listeners.push(cb);
    cb(this.settings);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private notify() { this.listeners.forEach(cb => cb(this.settings)); }
}

export const configService = new ConfigService();
