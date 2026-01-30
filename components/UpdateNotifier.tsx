import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import * as Updates from 'expo-updates';
import NetInfo from '@react-native-community/netinfo';
import { MaterialIcons } from '@expo/vector-icons';

/**
 * Composant de mise à jour - MODE DIAGNOSTIC
 * Affiche les erreurs brutes pour débogage sans console.
 */
export default function UpdateNotifier() {
  const [status, setStatus] = useState<string>('INIT DIAGNOSTIC...');
  const [details, setDetails] = useState<string>(''); // Pour l'erreur complète
  const [ready, setReady] = useState(false);
  const [isError, setIsError] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    async function checkUpdates() {
      try {
        const net = await NetInfo.fetch();
        if (!net.isConnected) {
           setStatus('OFFLINE');
           setDetails('Pas de connexion internet détectée.');
           setIsError(true);
           return;
        }

        setStatus('VÉRIFICATION...');
        const update = await Updates.checkForUpdateAsync();

        if (update.isAvailable) {
          setStatus('TÉLÉCHARGEMENT...');
          await Updates.fetchUpdateAsync();
          setStatus('SUCCÈS : MAJ PRÊTE');
          setReady(true);
        } else {
          setStatus('AUCUNE MAJ DISPO');
          setDetails(`Le serveur indique que l'app est à jour.\nRuntime: ${Updates.runtimeVersion}`);
          // Masquage auto si tout va bien
          setTimeout(() => setVisible(false), 4000);
        }

      } catch (error: any) {
        setIsError(true);
        setStatus('ÉCHEC UPDATE');
        // On capture le message d'erreur complet
        setDetails(`${error.message}\n\nCode: ${error.code || 'N/A'}`);
      }
    }

    checkUpdates();
  }, []);

  if (!visible) return null;

  return (
    <View style={[styles.container, isError ? styles.borderError : ready ? styles.borderReady : styles.borderChecking]}>
      <View style={styles.header}>
        <Text style={[styles.statusText, isError ? styles.textError : ready ? styles.textReady : null]}>
            {status}
        </Text>
        <TouchableOpacity onPress={() => setVisible(false)} style={styles.closeBtn}>
            <MaterialIcons name="close" size={20} color="#71717a" />
        </TouchableOpacity>
      </View>

      {/* Zone de détails techniques (ID, Version, Erreur) */}
      <ScrollView style={styles.logBox} nestedScrollEnabled>
        <Text style={styles.logText}>Runtime: {Updates.runtimeVersion}</Text>
        <Text style={styles.logText}>Channel: {Updates.channel || 'production (forced)'}</Text>
        <Text style={styles.logText}>ProjectID: {Updates.updateId ? 'OK' : 'Waiting...'}</Text>
        <View style={styles.divider} />
        <Text style={[styles.logText, isError && {color: '#f87171'}]}>
            {details || 'En attente...'}
        </Text>
      </ScrollView>

      {ready && (
        <TouchableOpacity onPress={() => Updates.reloadAsync()} style={styles.installBtn}>
            <MaterialIcons name="system-update" size={24} color="black" style={{marginRight: 10}} />
            <Text style={styles.installText}>INSTALLER</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginTop: 20,
    backgroundColor: '#09090b',
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    maxHeight: 300,
  },
  borderChecking: { borderColor: '#3b82f6' },
  borderReady: { borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.1)' },
  borderError: { borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)' },
  
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  statusText: {
    color: '#3b82f6',
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 14,
  },
  textReady: { color: '#22c55e' },
  textError: { color: '#ef4444' },
  
  closeBtn: { padding: 5 },
  
  logBox: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    borderRadius: 4,
    marginBottom: 10,
  },
  logText: {
    color: '#a1a1aa',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 5,
  },
  
  installBtn: {
    backgroundColor: '#22c55e',
    paddingVertical: 12,
    borderRadius: 6,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  installText: {
    color: 'black',
    fontWeight: '900',
    fontSize: 14,
  },
});
