/**
 * LOCATION SERVICE - VERSION AMÉLIORÉE
 * * Améliorations:
 * - Filtre Kalman pour lissage positions
 * - Détection de mouvement
 * - Validation des données GPS
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

const LOCATION_TASK_NAME = 'background-location-task';

export interface LocationData {
    latitude: number;
    longitude: number;
    heading: number | null;
    speed: number | null;
    timestamp: number;
    accuracy: number | null;
}

// ============ FILTRE KALMAN ============\n
class KalmanFilter {
    private q: number; 
    private r: number; 
    private p: number = 1;
    private x: number = 0;
    private k: number = 0;

    constructor(q: number = 0.0001, r: number = 0.01) {
        this.q = q;
        this.r = r;
    }

    reset(initialValue: number = 0) {
        this.x = initialValue;
        this.p = 1;
    }

    update(measurement: number): number {
        this.p = this.p + this.q;
        this.k = this.p / (this.p + this.r);
        this.x = this.x + this.k * (measurement - this.x);
        this.p = (1 - this.k) * this.p;
        return this.x;
    }
}

class LocationService {
    private subscribers: ((loc: LocationData) => void)[] = [];
    private lastLocation: LocationData | null = null;
    private isTracking = false;

    // Kalman filters for Lat/Lng
    private latFilter = new KalmanFilter();
    private lngFilter = new KalmanFilter();
    private isFiltersInitialized = false;

    private isMoving = false;
    private stationaryTimer: any;
    private STATIONARY_TIMEOUT = 1000 * 60; 

    private locationOptions: Location.LocationTaskOptions = {
        accuracy: Location.Accuracy.High, 
        distanceInterval: 10, 
        timeInterval: 5000,
        deferredUpdatesInterval: 5000, 
        deferredUpdatesDistance: 10, 
        pausesUpdatesAutomatically: false, 
        activityType: Location.ActivityType.Fitness, 
        showsBackgroundLocationIndicator: true, 
        foregroundService: {
            notificationTitle: "Praxis Actif",
            notificationBody: "Position et lien tactique maintenus",
            notificationColor: "#000000"
        }
    };

    constructor() {
        this.defineTask();
    }

    public async updateOptions(newOptions: Partial<Location.LocationTaskOptions>) {
        console.log("[Location] Mise à jour dynamique des options:", newOptions);
        this.locationOptions = { ...this.locationOptions, ...newOptions };

        if (this.isTracking) {
            await this.stopTracking();
            await this.startTracking();
        }
    }

    private defineTask() {
        TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
            if (error) return;
            if (data) {
                const { locations } = data as any;
                const latest = locations[locations.length - 1];
                if (latest) {
                    this.processLocation(latest);
                }
            }
        });
    }

    async startTracking() {
        if (this.isTracking) return;

        const { status } = await Location.requestBackgroundPermissionsAsync();
        
        if (status !== 'granted') {
            const fgStatus = await Location.requestForegroundPermissionsAsync();
            if (fgStatus.status !== 'granted') return;
        }

        try {
            await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, this.locationOptions);
            
            await Location.watchPositionAsync({
                accuracy: this.locationOptions.accuracy as Location.Accuracy,
                distanceInterval: this.locationOptions.distanceInterval,
                timeInterval: this.locationOptions.timeInterval
            }, (loc) => {
                 this.processLocation(loc);
            });

            this.isTracking = true;
        } catch (e) {
            console.error("[Location] Erreur démarrage tracking:", e);
        }
    }

    async stopTracking() {
        if (!this.isTracking) return;
        try {
            const isRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
            if (isRegistered) {
                await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
            }
        } catch(e) {
            console.warn("[Location] Erreur arrêt tracking:", e);
        }
        this.isTracking = false;
        if (this.stationaryTimer) clearTimeout(this.stationaryTimer);
    }

    private processLocation(rawLoc: any) {
        if (rawLoc.coords.accuracy && rawLoc.coords.accuracy > 50) return;

        if (!this.isFiltersInitialized) {
            this.latFilter.reset(rawLoc.coords.latitude);
            this.lngFilter.reset(rawLoc.coords.longitude);
            this.isFiltersInitialized = true;
        }

        const filteredLat = this.latFilter.update(rawLoc.coords.latitude);
        const filteredLng = this.lngFilter.update(rawLoc.coords.longitude);

        this.isMoving = true;
        this.setStationaryTimer();

        const newLoc: LocationData = {
            latitude: filteredLat,
            longitude: filteredLng,
            heading: rawLoc.coords.heading,
            speed: rawLoc.coords.speed,
            timestamp: rawLoc.timestamp,
            accuracy: rawLoc.coords.accuracy
        };

        this.lastLocation = newLoc;
        this.notify(newLoc);
    }

    private setStationaryTimer() {
        if (this.stationaryTimer) clearTimeout(this.stationaryTimer);
        this.stationaryTimer = setTimeout(() => {
            this.isMoving = false;
        }, this.STATIONARY_TIMEOUT);
    }

    subscribe(cb: (loc: LocationData) => void) {
        this.subscribers.push(cb);
        if (this.lastLocation) cb(this.lastLocation);
        return () => { this.subscribers = this.subscribers.filter(s => s !== cb); };
    }

    private notify(loc: LocationData) {
        this.subscribers.forEach(cb => cb(loc));
    }
}

export const locationService = new LocationService();
