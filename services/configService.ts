/**
 * Service de Configuration
 * Gère les paramètres de l'application avec persistance MMKV
 */

import { AppSettings, DEFAULT_SETTINGS } from '../types';
import { mmkvStorage } from './mmkvStorage';

const CONFIG_KEY = 'praxis_app_settings';

class ConfigService {
  private settings: AppSettings = DEFAULT_SETTINGS;
  private initialized = false;

  /**
   * Initialise le service de configuration
   */
  async init(): Promise<AppSettings> {
    if (this.initialized) return this.settings;

    try {
      const stored = mmkvStorage.getObject<AppSettings>(CONFIG_KEY, true);
      if (stored) {
        this.settings = { ...DEFAULT_SETTINGS, ...stored };
      }
      this.initialized = true;
    } catch (e) {
      console.error('[ConfigService] Init error:', e);
    }

    return this.settings;
  }

  /**
   * Récupère les paramètres actuels
   */
  get(): AppSettings {
    return this.settings;
  }

  /**
   * Met à jour les paramètres
   */
  async update(updates: Partial<AppSettings>): Promise<void> {
    this.settings = { ...this.settings, ...updates };

    // SYNC STORE
    import('../store/usePraxisStore').then(({ usePraxisStore }) => {
      usePraxisStore.getState().actions.updateSettings(updates);
    });

    try {
      mmkvStorage.setObject(CONFIG_KEY, this.settings, true);
    } catch (e) {
      console.error('[ConfigService] Update error:', e);
    }
  }

  /**
   * Réinitialise les paramètres
   */
  async reset(): Promise<void> {
    this.settings = DEFAULT_SETTINGS;
    try {
      mmkvStorage.setObject(CONFIG_KEY, this.settings, true);
    } catch (e) {
      console.error('[ConfigService] Reset error:', e);
    }
  }

  /**
   * Récupère une valeur spécifique
   */
  getValue<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key];
  }

  /**
   * Met à jour une valeur spécifique
   */
  async setValue<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ): Promise<void> {
    this.settings[key] = value;
    await this.update({});
  }
}

export const configService = new ConfigService();
export default configService;
