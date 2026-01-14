import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppSettings, DEFAULT_SETTINGS } from '../types';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { CONFIG } from '../constants';

const CONFIG_KEY = 'ComTac_Settings_v1';

class ConfigService {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private listeners: ((settings: AppSettings) => void)[] = [];

  async init() {
    try {
      // 1. Charger les settings principaux
      const json = await AsyncStorage.getItem(CONFIG_KEY);
      if (json) {
        const loaded = JSON.parse(json);
        // Fusion intelligente : on garde les defaults pour les nouvelles clés, on écrase avec le stocké
        this.settings = { ...DEFAULT_SETTINGS, ...loaded };
        
        // Sécurité: Si la liste de messages est vide ou corrompue dans le stockage, on remet celle par défaut
        if (!this.settings.quickMessages || !Array.isArray(this.settings.quickMessages) || this.settings.quickMessages.length === 0) {
             this.settings.quickMessages = DEFAULT_SETTINGS.quickMessages;
        }
      }

      // 2. Rétro-compatibilité pour le Trigramme (Migration v13 -> v14)
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
    
    // Si l'username change, on met à jour le stockage legacy (au cas où on downgrade)
    if (newSettings.username) {
        try {
            await AsyncStorage.setItem(CONFIG.TRIGRAM_STORAGE_KEY, newSettings.username);
        } catch (e) {}
    }

    this.notify();
    await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(this.settings));
  }

  // Export en fichier .json
  async exportConfig() {
    const fileUri = FileSystem.documentDirectory + 'comtac_config.json';
    await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(this.settings, null, 2));
    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
    }
  }

  async importConfig(jsonString: string) {
      try {
          const parsed = JSON.parse(jsonString);
          // Validation basique
          if (typeof parsed === 'object') {
              await this.update(parsed);
              return true;
          }
          return false;
      } catch (e) { return false; }
  }
  
  // NOUVEAU : Import spécifique de messages via un fichier JSON (msg.json)
  async importMessagesFromFile(uri: string): Promise<boolean> {
      try {
          const content = await FileSystem.readAsStringAsync(uri);
          const parsed = JSON.parse(content);
          
          if (Array.isArray(parsed) && parsed.every(i => typeof i === 'string')) {
              await this.update({ quickMessages: parsed });
              return true;
          }
          return false;
      } catch (e) {
          console.warn("Erreur import messages", e);
          return false;
      }
  }

  // Réinitialiser les messages par défaut
  async resetMessages() {
      await this.update({ quickMessages: DEFAULT_SETTINGS.quickMessages });
  }

  subscribe(cb: (s: AppSettings) => void) {
    this.listeners.push(cb);
    cb(this.settings);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  private notify() { this.listeners.forEach(cb => cb(this.settings)); }
}

export const configService = new ConfigService();
