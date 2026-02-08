/**
 * Service de Localisation
 * Gère le suivi GPS avec haute performance
 */


import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { EventEmitter } from 'events';
import { configService } from './configService';

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
  private headingSubscription: any | null = null;
  private lastLocation: LocationData | null = null;
  private latestHeading: number | null = null; // Magnetic heading storage
  private isLandscape: boolean = false;
  private lastEmittedHeading: number | null = null; // Dernier heading transmis
  private lastHeadingEmitTime: number = 0; // Timestamp de la dernière émission
  private headingFallbackInterval: NodeJS.Timeout | null = null; // Fallback si sensor s'arrête
  private backgroundPulseInterval: NodeJS.Timeout | null = null; // Guaranteed background tick

  setOrientation(isLandscape: boolean) {
    this.isLandscape = isLandscape;
  }

  /**
   * Met à jour les options de suivi
   */
  updateOptions(options: Partial<LocationOptions>): void {
    this.options = { ...this.options, ...options };

    // Redémarrer le suivi si actif
    if (this.isTracking) {
      // FIX RACE CONDITION: Ensure stop completes before start
      this.stopTracking().then(() => {
        this.startTracking();
      });
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

      // START BACKGROUND PULSE LOOP
      // Independent timer to guarantee network traffic even if stationary
      this.startBackgroundPulse();

      // Souscription en premier plan pour des mises à jour plus rapides
      this.locationSubscription = await Location.watchPositionAsync(
        {
          accuracy: this.options.accuracy,
          timeInterval: this.options.timeInterval,
          distanceInterval: this.options.distanceInterval,
        },
        (location) => {
          // FILTRAGE GPS

          // FILTRAGE GPS

          // 1. Précision relaxée pour accepter les points un peu moins précis mais valides
          if (location.coords.accuracy && location.coords.accuracy > 150) {
            // console.log('[LocationService] Rejected low accuracy:', location.coords.accuracy);
            return;
          }

          // 2. Vitesse / Cohérence 
          // On désactive temporairement le filtre de saut "worse jumps" pour voir si c'était lui le coupable
          // Le filtre de précision devrait suffire pour les antennes relais (souvent > 1000m)
          if (this.lastLocation) {
            // ...
          }

          /*
          if (this.lastLocation) {
            const timeDelta = (location.timestamp - this.lastLocation.timestamp) / 1000; // secondes
            if (timeDelta > 0) {
              const dist = this.calculateDistance(
                this.lastLocation.latitude, this.lastLocation.longitude,
                location.coords.latitude, location.coords.longitude
              );

              // On accepte les sauts importants SI le temps écoulé est grand (ex: sortie de tunnel / reprise après pause)
              // MAIS si c'est rapproché, on filtre.
              const speed = dist / timeDelta; // m/s

              if (speed > 83) { // ~300 km/h
                console.log(`[LocationService] Rejected jump: ${Math.round(dist)}m in ${timeDelta.toFixed(1)}s (${Math.round(speed * 3.6)}km/h)`);
                return;
              }
            }
          }
          */

          // 2. Vitesse / Cohérence : On rejette si saut impossible (> 300km/h soit ~83m/s)
          // Cela protège contre les abérrations GPS instantanées même avec "bonne" précision
          if (this.lastLocation) {
            const timeDelta = (location.timestamp - this.lastLocation.timestamp) / 1000; // secondes
            if (timeDelta > 0) {
              const dist = this.calculateDistance(
                this.lastLocation.latitude, this.lastLocation.longitude,
                location.coords.latitude, location.coords.longitude
              );

              // On accepte les sauts importants SI le temps écoulé est grand (ex: sortie de tunnel / reprise après pause)
              // MAIS si c'est rapproché, on filtre.
              const speed = dist / timeDelta; // m/s

              if (speed > 83) { // ~300 km/h
                console.log(`[LocationService] Rejected jump: ${Math.round(dist)}m in ${timeDelta.toFixed(1)}s (${Math.round(speed * 3.6)}km/h)`);
                return;
              }
            }
          }

          // 3. Rejet 0,0
          if (location.coords.latitude === 0 && location.coords.longitude === 0) return;

          // 4. Filtrage du bruit (Mouvements infimes)
          // On ignore les déplacements < 2m si l'intervalle de temps est court (< 10s)
          // Cela permet de stabiliser l'icône à l'arrêt sans ajouter de latence en mouvement rapide.
          if (this.lastLocation) {
            const dist = this.calculateDistance(
              this.lastLocation.latitude, this.lastLocation.longitude,
              location.coords.latitude, location.coords.longitude
            );
            const timeDelta = (location.timestamp - this.lastLocation.timestamp) / 1000;

            if (dist < 2 && timeDelta < 10) {
              // Mouvement trop petit pour être significatif (bruit GPS)
              return;
            }
          }

          // 5. Sensor Fusion (Heading)
          // Si vitesse > 1m/s, on utilise le CAP GPS (Course)
          // Sinon, on utilise le CAP Magnétique (si disponible)
          let finalHeading = location.coords.heading;
          const speedCheck = location.coords.speed || 0;
          if (speedCheck < 1 && this.latestHeading !== null) {
            finalHeading = this.latestHeading;
          }

          const locData: LocationData = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            altitude: location.coords.altitude,
            accuracy: location.coords.accuracy,
            heading: finalHeading,
            speed: location.coords.speed,
            timestamp: location.timestamp,
          };
          this.lastLocation = locData;
          locationEmitter.emit('location', locData);

          // SYNC STORE
          // Update local user position in global store
          import('../store/usePraxisStore').then(({ usePraxisStore }) => {
            usePraxisStore.getState().actions.setUserPosition(locData.latitude, locData.longitude, locData.heading || undefined);
          });
        }
      );

      // Souscription au Heading (Location Service - Works in Background)
      // Remplacement de Magnetometer par watchHeadingAsync pour support background
      this.headingSubscription = await Location.watchHeadingAsync((newHeading) => {
        let heading = newHeading.magHeading;

        // Correction pour le mode Paysage (Landscape Left standard)
        // En paysage, l'affichage est tourné de 90 degrés
        if (this.isLandscape) {
          heading = (heading - 90 + 360) % 360;
        }

        // Safety check for NaN
        if (isNaN(heading)) heading = 0;

        this.latestHeading = heading;

        // THROTTLING INTELLIGENT: Éviter de flooder le réseau avec des micro-changements
        // On émet seulement si:
        // 1. Changement significatif (>5°) OU
        // 2. Plus de 2s depuis la dernière émission (pour garder "vivant" même si immobile)
        const now = Date.now();
        const headingDelta = this.lastEmittedHeading !== null
          ? Math.abs(heading - this.lastEmittedHeading)
          : 999; // Force première émission
        const timeSinceLastEmit = now - this.lastHeadingEmitTime;

        const shouldEmit = headingDelta > 5 || timeSinceLastEmit > 2000;

        if (shouldEmit) {
          this.lastEmittedHeading = heading;
          this.lastHeadingEmitTime = now;

          // CRITICAL FIX: Émettre les changements d'orientation significatifs
          // Même si le GPS n'a pas bougé, on DOIT transmettre l'orientation aux autres
          // Sinon, un utilisateur stationnaire en arrière-plan "gèle" visuellement pour les autres
          if (this.lastLocation) {
            // Mettre à jour le heading dans la dernière position connue
            this.lastLocation.heading = heading;
            // Forcer l'émission pour déclencher pulse() et updateUserPosition()
            locationEmitter.emit('location', this.lastLocation);
          } else {
            // Edge case: Pas encore de position GPS, mais on a un cap
            // Créer une location minimale pour transmettre au moins le heading
            const minimalLocation: LocationData = {
              latitude: 0,
              longitude: 0,
              altitude: null,
              accuracy: null,
              heading: heading,
              speed: null,
              timestamp: Date.now()
            };
            locationEmitter.emit('location', minimalLocation);
          }
        }
      });

      // FALLBACK CRITIQUE: Sur certains Android, watchHeadingAsync s'arrête en arrière-plan
      // Solution: Timer de secours qui force une émission périodique du dernier heading connu
      this.headingFallbackInterval = setInterval(() => {
        const now = Date.now();
        const timeSinceLastEmit = now - this.lastHeadingEmitTime;

        // Si aucune mise à jour depuis 10s, forcer une émission (le sensor a probablement gelé)
        if (timeSinceLastEmit > 10000 && this.latestHeading !== null && this.lastLocation) {
          console.log('[LocationService] Fallback: Forcing heading update (sensor may be sleeping)');
          this.lastHeadingEmitTime = now;
          this.lastLocation.heading = this.latestHeading;
          locationEmitter.emit('location', this.lastLocation);
        }
      }, 5000); // Vérifier toutes les 5s

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
      if (this.headingSubscription) {
        this.headingSubscription.remove();
        this.headingSubscription = null;
      }

      // Arrêter le fallback timer heading
      if (this.headingFallbackInterval) {
        clearInterval(this.headingFallbackInterval);
        this.headingFallbackInterval = null;
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

  /**
   * Calcule la distance en mètres entre deux points (Haversine)
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Rayon de la terre en mètres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * GUARANTEED BACKGROUND TICK
   * Force a pulse emission every X seconds to keep network alive
   * This runs inside the context of the service wrapper (App scope) but requires
   * the Foreground Service to keep the App process alive.
   */
  private startBackgroundPulse() {
    if (this.backgroundPulseInterval) clearInterval(this.backgroundPulseInterval);

    // Pulse every 10 seconds (aligned with heartbeat interval)
    // This is safe because Foreground Service keeps CPU awake.
    // Get interval from settings (default 10s)
    const interval = configService.get().heartbeatInterval || 10000;
    console.log(`[LocationService] Background pulse: ${interval}ms`);

    this.backgroundPulseInterval = setInterval(() => {
      // Emit a 'pulse' event that App.tsx or ConnectivityService listens to
      locationEmitter.emit('pulse');
    }, interval);
  }
}

export const locationService = new LocationService();
export default locationService;
