import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';

const LOCATION_TASK_NAME = 'background-location-task';

// Interface pour les coordonnées
export interface LocationData {
    latitude: number;
    longitude: number;
    heading: number | null;
    speed: number | null;
    timestamp: number;
    accuracy: number | null;
}

class LocationService {
    private subscribers: ((loc: LocationData) => void)[] = [];
    private lastLocation: LocationData | null = null;
    private isTracking = false;

    // Configuration par défaut (Mode "Normal/Équilibré")
    // Ces valeurs seront écrasées par updateOptions() venant des Settings
    private locationOptions: Location.LocationTaskOptions = {
        accuracy: Location.Accuracy.High, 
        distanceInterval: 10, 
        timeInterval: 5000,
        deferredUpdatesInterval: 5000, 
        deferredUpdatesDistance: 10, 
        
        // Options iOS critiques (toujours actives par défaut)
        pausesUpdatesAutomatically: false, 
        activityType: Location.ActivityType.Fitness, 
        showsBackgroundLocationIndicator: true, 
        
        // Options Android
        foregroundService: {
            notificationTitle: "Praxis Actif",
            notificationBody: "Position et lien tactique maintenus",
            notificationColor: "#000000"
        }
    };

    constructor() {
        this.defineTask();
    }

    // --- API PUBLIQUE POUR LES REGLAGES ---
    
    /**
     * Permet à la modale Settings de mettre à jour la stratégie GPS
     * (Ex: Passer en mode "Navigation" précis ou "Économie")
     */
    public async updateOptions(newOptions: Partial<Location.LocationTaskOptions>) {
        console.log("[Location] Mise à jour dynamique des options:", newOptions);
        
        // Fusion avec les options existantes
        this.locationOptions = { ...this.locationOptions, ...newOptions };

        // Si le tracking est actif, on doit le redémarrer pour que OS prenne en compte les changements
        // (Android/iOS ne permettent pas de changer les paramètres d'un service actif à la volée sans restart)
        if (this.isTracking) {
            console.log("[Location] Redémarrage du service pour appliquer les nouveaux réglages...");
            await this.stopTracking();
            await this.startTracking();
        }
    }

    private defineTask() {
        TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
            if (error) {
                console.error("[Location] Background Task Error:", error);
                return;
            }
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
            console.warn("[Location] Background permission denied or limited");
            const fgStatus = await Location.requestForegroundPermissionsAsync();
            if (fgStatus.status !== 'granted') return;
        }

        console.log(`[Location] Démarrage (Précision: ${this.locationOptions.accuracy}, Interval: ${this.locationOptions.timeInterval}ms)`);
        
        try {
            // 1. Service d'arrière-plan (Le coeur du maintien en vie)
            await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, this.locationOptions);
            
            // 2. Watcher de premier plan (Pour la fluidité UI quand l'app est ouverte)
            // On aligne les paramètres du watcher sur ceux du background pour la cohérence
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
    }

    private processLocation(rawLoc: any) {
        // Filtrage de sécurité pour éviter les sauts GPS majeurs (>100m d'erreur)
        if (rawLoc.coords.accuracy && rawLoc.coords.accuracy > 100) {
            return;
        }

        const newLoc: LocationData = {
            latitude: rawLoc.coords.latitude,
            longitude: rawLoc.coords.longitude,
            heading: rawLoc.coords.heading,
            speed: rawLoc.coords.speed,
            timestamp: rawLoc.timestamp,
            accuracy: rawLoc.coords.accuracy
        };

        this.lastLocation = newLoc;
        this.notify(newLoc);
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
