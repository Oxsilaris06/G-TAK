import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import * as Updates from 'expo-updates';
import NetInfo from '@react-native-community/netinfo';
import { MaterialIcons } from '@expo/vector-icons';

/**
 * Composant de mise à jour style "Tactique"
 * S'affiche uniquement sur l'écran de login.
 */
export default function UpdateNotifier() {
  const [status, setStatus] = useState<string>('INIT SYSTEM...');
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function checkUpdates() {
      try {
        if (__DEV__) {
          setStatus('DEV MODE: SKIP UPDATE');
          setChecking(false);
          // Masquer auto après 2s en dev
          setTimeout(() => setVisible(false), 2000);
          return;
        }

        const net = await NetInfo.fetch();
        if (!net.isConnected) {
           setStatus('OFFLINE: UPDATE ABORTED');
           setChecking(false);
           setTimeout(() => setVisible(false), 3000);
           return;
        }

        setStatus('CHECKING REMOTE...');
        const update = await Updates.checkForUpdateAsync();

        if (update.isAvailable) {
          setStatus('DOWNLOADING ASSETS...');
          await Updates.fetchUpdateAsync();
          setStatus('UPDATE READY TO INSTALL');
          setReady(true);
          setChecking(false);
        } else {
          setStatus('SYSTEM UP TO DATE');
          setChecking(false);
          setTimeout(() => setVisible(false), 3000);
        }

      } catch (error: any) {
        // En cas d'erreur, on affiche un message court et on laisse l'utilisateur fermer
        setStatus('UPDATE SERVER ERROR');
        setChecking(false);
        console.log("Update Error:", error);
      }
    }

    checkUpdates();
  }, []);

  if (!visible) return null;

  return (
    <View style={[styles.container, ready ? styles.borderReady : styles.borderChecking]}>
      <View style={styles.header}>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
            {checking && <ActivityIndicator size="small" color={ready ? "#22c55e" : "#3b82f6"} style={{marginRight: 10}} />}
            <Text style={[styles.statusText, ready && styles.textReady]}>{status}</Text>
        </View>
        <TouchableOpacity onPress={() => setVisible(false)} style={styles.closeBtn}>
            <MaterialIcons name="close" size={20} color="#71717a" />
        </TouchableOpacity>
      </View>

      {ready && (
        <TouchableOpacity onPress={() => Updates.reloadAsync()} style={styles.installBtn}>
            <MaterialIcons name="system-update" size={24} color="black" style={{marginRight: 10}} />
            <Text style={styles.installText}>INSTALLER & REDÉMARRER</Text>
        </TouchableOpacity>
      )}
      
      {/* Affichage discret de la version pour debug */}
      <Text style={styles.versionInfo}>
        v{Updates.runtimeVersion} | {Updates.channel || 'default'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginTop: 30,
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
  },
  borderChecking: {
    borderColor: '#3b82f6', // Bleu (cohérent avec Praxis)
  },
  borderReady: {
    borderColor: '#22c55e', // Vert (Succès)
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  statusText: {
    color: '#3b82f6',
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    letterSpacing: 1,
  },
  textReady: {
    color: '#22c55e',
  },
  closeBtn: {
    padding: 5,
  },
  installBtn: {
    marginTop: 10,
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
  versionInfo: {
    marginTop: 8,
    color: '#52525b',
    fontSize: 9,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  }
});
