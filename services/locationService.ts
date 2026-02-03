/**
 * Service de Localisation
 * Gère le suivi GPS avec haute performance
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { EventEmitter } from 'events';

const LOCATION_TASK_NAME = 'praxis-background-location-task';

interface LocationOptions {
  timeInterval?: number;
  distanceInterval?: number;
  accuracy?: Location.LocationAccuracy;
  foregroundService?: {
    notificationTitle: string;
    notificationBody: string;
    notificationColor?: string;
  };
}

interface LocationData {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

// EventEmitter pour les mises à jour de position
class LocationEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(20);
  }
}

const locationEmitter = new LocationEventEmitter();

// Définition de la tâche en arrière-plan
TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }: any) => {
  if (error) {
    console.error('[LocationService] Background task error:', error);
    return;
  }
  if (data) {
    const { locations } = data;
    if (locations && locations.length > 0) {
      const loc = locations[0];
      locationEmitter.emit('location', {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        altitude: loc.coords.altitude,
        accuracy: loc.coords.accuracy,
        heading: loc.coords.heading,
        speed: loc.coords.speed,
        timestamp: loc.timestamp,
      });
    }
  }
});

class LocationService {
  private isTracking = false;
  private options: LocationOptions = {
    timeInterval: 5000,
    distanceInterval: 5,
    accuracy: Location.LocationAccuracy.BestForNavigation,
  };
  private locationSubscription: Location.LocationSubscription | null = null;
  private lastLocation: LocationData | null = null;

  /**
   * Met à jour les options de suivi
   */
  updateOptions(options: Partial<LocationOptions>): void {
    this.options = { ...this.options, ...options };
    
    // Redémarrer le suivi si actif
    if (this.isTracking) {
      this.stopTracking();
      this.startTracking();
    }
  }

  /**
   * Démarre le suivi de position
   */
  async startTracking(): Promise<boolean> {
    if (this.isTracking) return true;

    try {
      // Vérifier les permissions
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.warn('[LocationService] Location permission not granted');
        return false;
      }

      // Démarrer le suivi en arrière-plan si configuré
      if (this.options.foregroundService) {
        const hasStarted = await Location.hasStartedLocationUpdatesAsync(
          LOCATION_TASK_NAME
        );
        if (!hasStarted) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: this.options.accuracy,
            timeInterval: this.options.timeInterval,
            distanceInterval: this.options.distanceInterval,
            showsBackgroundLocationIndicator: true,
            foregroundService: this.options.foregroundService,
            pausesUpdatesAutomatically: false,
          });
        }
      }

      // Souscription en premier plan pour des mises à jour plus rapides
      this.locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: this.options.accuracy,
          timeInterval: this.options.timeInterval,
          distanceInterval: this.options.distanceInterval,
        },
        (location) => {
          const locData: LocationData = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            altitude: location.coords.altitude,
            accuracy: location.coords.accuracy,
            heading: location.coords.heading,
            speed: location.coords.speed,
            timestamp: location.timestamp,
          };
          this.lastLocation = locData;
          locationEmitter.emit('location', locData);
        }
      );

      this.isTracking = true;
      return true;
    } catch (e) {
      console.error('[LocationService] Start tracking error:', e);
      return false;
    }
  }

  /**
   * Arrête le suivi de position
   */
  async stopTracking(): Promise<void> {
    try {
      // Arrêter la souscription en premier plan
      if (this.locationSubscription) {
        this.locationSubscription.remove();
        this.locationSubscription = null;
      }

      // Arrêter la tâche en arrière-plan
      const hasStarted = await Location.hasStartedLocationUpdatesAsync(
        LOCATION_TASK_NAME
      );
      if (hasStarted) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }

      this.isTracking = false;
    } catch (e) {
      console.error('[LocationService] Stop tracking error:', e);
    }
  }

  /**
   * Récupère la dernière position connue
   */
  getLastLocation(): LocationData | null {
    return this.lastLocation;
  }

  /**
   * Récupère la position actuelle (one-shot)
   */
  async getCurrentPosition(): Promise<LocationData | null> {
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.LocationAccuracy.BestForNavigation,
      });

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        altitude: position.coords.altitude,
        accuracy: position.coords.accuracy,
        heading: position.coords.heading,
        speed: position.coords.speed,
        timestamp: position.timestamp,
      };
    } catch (e) {
      console.error('[LocationService] Get current position error:', e);
      return null;
    }
  }

  /**
   * S'abonne aux mises à jour de position
   */
  subscribe(callback: (location: LocationData) => void): () => void {
    locationEmitter.on('location', callback);
    return () => {
      locationEmitter.off('location', callback);
    };
  }

  /**
   * Vérifie si le suivi est actif
   */
  isTrackingActive(): boolean {
    return this.isTracking;
  }
}

export const locationService = new LocationService();
export default locationService;
