import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { connectivityService } from './connectivityService';

export const LOCATION_TASK_NAME = 'TACTICAL_BACKGROUND_TRACKING';

/**
 * Cette tâche est invoquée par le système (Foreground Service sur Android).
 * Elle reçoit les updates GPS et les transmet au connectivityService.
 * Le simple fait que cette fonction JS s'exécute garde la connexion WebRTC/WebSocket ouverte.
 */
TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
  if (error) {
    console.error('[BG] Erreur tâche localisation:', error);
    return;
  }
  
  if (data) {
    const { locations } = data as { locations: Location.LocationObject[] };
    const loc = locations[0];
    
    if (loc) {
       const { latitude, longitude, heading, speed } = loc.coords;
       
       // Log léger pour debug (optionnel)
       // console.log('[BG] Heartbeat Backbone:', latitude, longitude);

       // On relaie au singleton qui maintient la connexion
       // Cela permet de mettre à jour la position ET de garder le socket actif
       connectivityService.handleBackgroundLocation(latitude, longitude, heading || 0);
    }
  }
});
