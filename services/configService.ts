import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings, DEFAULT_SETTINGS } from '../types';
import { CONFIG } from '../constants';
import { locationService } from './locationService'; // Import du service

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

      // --- APPLICATION INITIALE DES REGLAGES GPS ---
      this.applyLocationSettings(this.settings);

    } catch (e) {
      console.warn("Erreur chargement config", e);
    }
    return this.settings;
  }

  get() { return this.settings; }

  async update(newSettings: Partial<AppSettings>) {
    // 1. Mise à jour de l'objet local
    this.settings = { ...this.settings, ...newSettings };
    
    // 2. Synchro legacy
    if (newSettings.username) {
        try {
            await AsyncStorage.setItem(CONFIG.TRIGRAM_STORAGE_KEY, newSettings.username);
        } catch (e) {}
    }

    // 3. APPLICATION DYNAMIQUE AU SERVICE GPS
    // Si l'intervalle GPS change, on met à jour le service de loc immédiatement
    if (newSettings.gpsUpdateInterval !== undefined) {
        this.applyLocationSettings(this.settings);
    }

    // 4. Notification UI et Sauvegarde
    this.notify();
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.settings));
  }

  /**
   * Traduit les réglages "Utilisateur" en réglages "Techniques" pour le GPS
   */
  private applyLocationSettings(s: AppSettings) {
      const interval = s.gpsUpdateInterval || 5000;
      
      // Logique adaptative :
      // - Si intervalle court (< 2s) -> Mode "Assaut" (Précis, réactif, gourmand)
      // - Si intervalle long (> 10s) -> Mode "Patrouille" (Éco, moins précis)
      
      if (interval < 2000) {
          // MODE ASSAUT / HAUTE PRÉCISION
          locationService.updateOptions({
              accuracy: 6, // Accuracy.BestForNavigation (valeur enum expo)
              distanceInterval: 0, // Zéro latence
              timeInterval: interval,
              deferredUpdatesInterval: interval
          });
      } else {
          // MODE STANDARD / ÉCO
          locationService.updateOptions({
              accuracy: 4, // Accuracy.High
              distanceInterval: 10, // Filtre de 10m pour économiser batterie
              timeInterval: interval,
              deferredUpdatesInterval: interval
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
