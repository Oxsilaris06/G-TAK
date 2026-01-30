import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Composant qui vérifie les mises à jour EAS au démarrage.
 */
export default function UpdateNotifier() {
  const [status, setStatus] = useState<string | null>('Init...');
  const [showDebug, setShowDebug] = useState(true); // Mettre à false en prod finale

  useEffect(() => {
    async function checkUpdates() {
      try {
        if (__DEV__) {
          setStatus('Mode DEV (pas de MAJ)');
          return;
        }

        // Affiche la configuration actuelle pour débogage
        const configInfo = `Channel: ${Updates.channel || 'default'} | Runtime: ${Updates.runtimeVersion}`;
        setStatus(`Vérification... \n${configInfo}`);

        const update = await Updates.checkForUpdateAsync();

        if (update.isAvailable) {
          setStatus('Téléchargement en cours...');
          await Updates.fetchUpdateAsync();
          setStatus('Prêt !');

          Alert.alert(
            'Mise à jour disponible',
            'Une nouvelle version a été téléchargée. Redémarrer ?',
            [
              { text: 'Non', style: 'cancel', onPress: () => setShowDebug(false) },
              { text: 'OUI', onPress: () => Updates.reloadAsync() }
            ]
          );
        } else {
          setStatus(`À jour.\n${configInfo}`);
          // Masquer le debug après 5 secondes si aucune maj
          setTimeout(() => setShowDebug(false), 5000);
        }
      } catch (error: any) {
        setStatus(`Erreur: ${error.message}`);
        // Afficher l'erreur complète dans une alerte pour pouvoir la lire
        Alert.alert('Erreur Update', error.message);
      }
    }

    checkUpdates();
  }, []);

  if (!showDebug) return null;

  return (
    <View style={styles.container}>
      <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 10 }} />
      <Text style={styles.text}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    padding: 15,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
    elevation: 50, // <--- CRUCIAL POUR ANDROID (Force l'affichage au-dessus de la map)
    borderWidth: 1,
    borderColor: '#333'
  },
  text: {
    color: '#00FF00', // Vert style terminal
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1,
    flexWrap: 'wrap',
  }
});
