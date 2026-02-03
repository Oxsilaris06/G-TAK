/**
 * Service de Permissions
 * Gère les demandes de permissions avec cache
 */

import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { Camera } from 'expo-camera';
import * as Notifications from 'expo-notifications';
import { mmkvStorage } from './mmkvStorage';

interface PermissionStatus {
  location: boolean;
  camera: boolean;
  notifications: boolean;
  backgroundLocation: boolean;
}

const PERMISSION_CACHE_KEY = 'praxis_permissions_cache';

class PermissionService {
  private cache: PermissionStatus = {
    location: false,
    camera: false,
    notifications: false,
    backgroundLocation: false,
  };

  /**
   * Initialise le service et charge le cache
   */
  async init(): Promise<void> {
    const cached = mmkvStorage.getObject<PermissionStatus>(PERMISSION_CACHE_KEY, false);
    if (cached) {
      this.cache = cached;
    }
  }

  /**
   * Demande toutes les permissions nécessaires
   */
  async requestAllPermissions(): Promise<PermissionStatus> {
    const [location, camera, notifications] = await Promise.all([
      this.requestLocationPermission(),
      this.requestCameraPermission(),
      this.requestNotificationPermission(),
    ]);

    const backgroundLocation = location
      ? await this.requestBackgroundLocationPermission()
      : false;

    this.cache = {
      location,
      camera,
      notifications,
      backgroundLocation,
    };

    mmkvStorage.setObject(PERMISSION_CACHE_KEY, this.cache, false);

    return this.cache;
  }

  /**
   * Demande la permission de localisation
   */
  async requestLocationPermission(): Promise<boolean> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      const granted = status === 'granted';
      this.cache.location = granted;
      return granted;
    } catch (e) {
      console.error('[PermissionService] Location error:', e);
      return false;
    }
  }

  /**
   * Demande la permission de localisation en arrière-plan
   */
  async requestBackgroundLocationPermission(): Promise<boolean> {
    try {
      const { status } = await Location.requestBackgroundPermissionsAsync();
      const granted = status === 'granted';
      this.cache.backgroundLocation = granted;
      return granted;
    } catch (e) {
      console.error('[PermissionService] Background location error:', e);
      return false;
    }
  }

  /**
   * Demande la permission de caméra
   */
  async requestCameraPermission(): Promise<boolean> {
    try {
      const { status } = await Camera.requestCameraPermissionsAsync();
      const granted = status === 'granted';
      this.cache.camera = granted;
      return granted;
    } catch (e) {
      console.error('[PermissionService] Camera error:', e);
      return false;
    }
  }

  /**
   * Demande la permission de notifications
   */
  async requestNotificationPermission(): Promise<boolean> {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      const granted = status === 'granted';
      this.cache.notifications = granted;
      return granted;
    } catch (e) {
      console.error('[PermissionService] Notification error:', e);
      return false;
    }
  }

  /**
   * Vérifie si une permission est accordée
   */
  hasPermission(type: keyof PermissionStatus): boolean {
    return this.cache[type];
  }

  /**
   * Vérifie l'état actuel des permissions (sans demande)
   */
  async checkPermissions(): Promise<PermissionStatus> {
    try {
      const [locationStatus, cameraStatus, notificationStatus] = await Promise.all([
        Location.getForegroundPermissionsAsync(),
        Camera.getCameraPermissionsAsync(),
        Notifications.getPermissionsAsync(),
      ]);

      this.cache = {
        location: locationStatus.status === 'granted',
        camera: cameraStatus.status === 'granted',
        notifications: notificationStatus.status === 'granted',
        backgroundLocation: this.cache.backgroundLocation,
      };

      return this.cache;
    } catch (e) {
      console.error('[PermissionService] Check error:', e);
      return this.cache;
    }
  }
}

export const permissionService = new PermissionService();
export default permissionService;
