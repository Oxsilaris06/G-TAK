import { Alert, Platform } from 'react-native';
import { Camera } from 'expo-camera';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

class PermissionService {
  /**
   * Demande toutes les permissions critiques séquentiellement.
   * Retourne true si les permissions bloquantes (Loc Foreground) sont accordées.
   */
  async requestCriticalPermissions(): Promise<boolean> {
    try {
        console.log("[PERM] Démarrage séquence permissions...");

        // 1. Caméra (Pour le scan QR)
        const { status: camStatus } = await Camera.requestCameraPermissionsAsync();
        if (camStatus !== 'granted') {
            console.warn("[PERM] Caméra refusée");
            // On ne bloque pas l'app, mais le scanner ne marchera pas
        }

        // 2. Notifications (Pour les alertes tactiques)
        const { status: notifStatus } = await Notifications.requestPermissionsAsync();
        if (notifStatus !== 'granted') {
            console.warn("[PERM] Notifications refusées");
        }

        // 3. Localisation Premier Plan (CRITIQUE)
        // Sans ça, l'app ne sert à rien.
        const { status: locFgStatus } = await Location.requestForegroundPermissionsAsync();
        if (locFgStatus !== 'granted') {
            Alert.alert(
                "Arrêt Critique", 
                "L'accès à la localisation est impératif pour le fonctionnement du système Praxis.",
                [{ text: "Fermer" }]
            );
            return false;
        }

        // 4. Localisation Arrière-plan (BACKBONE)
        // C'est ce qui permet au 'foreground service' de tourner et de maintenir le WebRTC
        const { status: locBgStatus } = await Location.requestBackgroundPermissionsAsync();
        
        if (locBgStatus !== 'granted') {
            Alert.alert(
                "Mode Dégradé", 
                "L'accès 'Toujours autoriser' à la position est nécessaire pour maintenir la connexion quand l'écran est éteint. Sans cela, vous serez déconnecté en veille.",
                [{ text: "Compris" }]
            );
        } else {
            console.log("[PERM] Background Location accordée (Backbone actif).");
        }

        return true;

    } catch (e) {
        console.error("[PERM] Erreur demande permissions:", e);
        return false;
    }
  }
}

export const permissionService = new PermissionService();
