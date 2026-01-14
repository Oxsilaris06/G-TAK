import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Switch, TouchableOpacity, StyleSheet, ScrollView, TextInput, PanResponder, Animated, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { audioService } from '../services/audioService';
import { configService } from '../services/configService';
import { AppSettings } from '../types';

interface SettingsViewProps {
  onClose: () => void;
}

// Options de couleurs pour l'icône
const COLOR_OPTIONS = [
  { hex: '#3b82f6', name: 'Bleu (Défaut)' },
  { hex: '#10b981', name: 'Émeraude' },
  { hex: '#f97316', name: 'Orange' },
  { hex: '#a855f7', name: 'Violet' },
  { hex: '#ec4899', name: 'Rose' },
  { hex: '#06b6d4', name: 'Cyan' },
  { hex: '#ffffff', name: 'Blanc' },
];

// Options d'intervalle GPS
const GPS_OPTIONS = [
  { val: 2000, label: '2 sec' },
  { val: 5000, label: '5 sec' },
  { val: 10000, label: '10 sec' },
  { val: 60000, label: '1 min' },
];

// --- COMPOSANT SLIDER PERSONNALISÉ (Sans dépendance externe) ---
const CustomSlider = ({ value, onValueChange }: { value: number, onValueChange: (val: number) => void }) => {
    return (
        <View style={styles.sliderContainer}>
            <TouchableOpacity onPress={() => onValueChange(Math.max(0, value - 5))} style={styles.sliderBtn}>
                 <Ionicons name="remove" size={20} color="white" />
            </TouchableOpacity>
            
            <View style={styles.sliderTrack}>
                <View style={[styles.sliderFill, { width: `${value}%` }]} />
                <Text style={styles.sliderText}>{value}%</Text>
            </View>

            <TouchableOpacity onPress={() => onValueChange(Math.min(100, value + 5))} style={styles.sliderBtn}>
                 <Ionicons name="add" size={20} color="white" />
            </TouchableOpacity>
        </View>
    );
};

export default function SettingsView({ onClose }: SettingsViewProps) {
  const [isVoxEnabled, setIsVoxEnabled] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  
  // États de configuration
  const [username, setUsername] = useState('');
  const [gpsInterval, setGpsInterval] = useState(5000);
  const [arrowColor, setArrowColor] = useState('#3b82f6');
  const [voxSensitivity, setVoxSensitivity] = useState(50);
  
  // NOUVEAU : État pour l'info message
  const [msgCount, setMsgCount] = useState(0);

  // Pour gérer la sauvegarde différée du Trigramme (eviter save à chaque lettre)
  const [tempUsername, setTempUsername] = useState('');

  useEffect(() => {
    // 1. Abonnement Audio
    const unsubAudio = audioService.subscribe((mode, speaker) => {
        setIsVoxEnabled(mode === 'vox');
        setIsSpeakerOn(speaker);
    });
    
    // 2. Abonnement Config
    const unsubConfig = configService.subscribe((settings) => {
        setUsername(settings.username);
        // Si on n'est pas en train d'éditer, on sync le temp
        if (!tempUsername) setTempUsername(settings.username);
        
        setGpsInterval(settings.gpsUpdateInterval);
        setArrowColor(settings.userArrowColor);
        setVoxSensitivity(settings.voxSensitivity);
        setMsgCount(settings.quickMessages ? settings.quickMessages.length : 0);
    });

    return () => {
        unsubAudio();
        unsubConfig();
    };
  }, []);

  const handleVoxToggle = () => audioService.toggleVox();
  
  const handleSpeakerToggle = (val: boolean) => {
      audioService.setSpeaker(val);
      configService.update({ audioOutput: val ? 'hp' : 'casque' });
  };

  const handleSensitivityChange = (val: number) => {
      setVoxSensitivity(val);
      configService.update({ voxSensitivity: val });
      audioService.setVoxSensitivity(val);
  };

  const handleUsernameBlur = () => {
      if (tempUsername && tempUsername !== username) {
          configService.update({ username: tempUsername.toUpperCase() });
      }
  };

  const handleGpsChange = (val: number) => {
      configService.update({ gpsUpdateInterval: val });
  };

  const handleColorChange = (hex: string) => {
      configService.update({ userArrowColor: hex });
  };

  // NOUVEAU : Fonction d'import de messages
  const handleImportMessages = async () => {
      try {
          const result = await DocumentPicker.getDocumentAsync({
              type: 'application/json',
              copyToCacheDirectory: true
          });

          if (result.canceled) return;
          
          const file = result.assets[0];
          const success = await configService.importMessagesFromFile(file.uri);
          
          if (success) {
              Alert.alert("Succès", "Liste de messages rapides mise à jour.");
          } else {
              Alert.alert("Erreur", "Fichier JSON invalide. Il doit contenir une liste de textes.");
          }
      } catch (e) {
          Alert.alert("Erreur", "Impossible de lire le fichier.");
      }
  };

  const handleResetMessages = () => {
      Alert.alert(
          "Réinitialiser", 
          "Revenir à la liste par défaut ?",
          [
              { text: "Annuler", style: "cancel" },
              { text: "Oui", onPress: () => configService.resetMessages() }
          ]
      );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>CONFIGURATION</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Ionicons name="close" size={24} color="#ef4444" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        
        {/* SECTION IDENTITÉ */}
        <View style={styles.section}>
           <Text style={styles.sectionTitle}>IDENTITÉ OPÉRATEUR</Text>
           <View style={styles.inputContainer}>
               <TextInput 
                  style={styles.textInput}
                  value={tempUsername}
                  onChangeText={setTempUsername}
                  onBlur={handleUsernameBlur}
                  placeholder="TRIGRAMME"
                  placeholderTextColor="#52525b"
                  maxLength={6}
                  autoCapitalize="characters"
               />
               <Ionicons name="pencil" size={16} color="#71717a" style={{position: 'absolute', right: 15}}/>
           </View>
        </View>

        {/* SECTION MESSAGES RAPIDES (NOUVEAU) */}
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>MESSAGES RAPIDES ({msgCount})</Text>
            <View style={styles.row}>
                <TouchableOpacity onPress={handleImportMessages} style={styles.actionBtn}>
                    <Ionicons name="document-text-outline" size={20} color="#3b82f6" />
                    <Text style={styles.actionBtnText}>IMPORTER JSON</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleResetMessages} style={[styles.actionBtn, {borderColor: '#ef4444'}]}>
                    <Ionicons name="refresh" size={20} color="#ef4444" />
                    <Text style={[styles.actionBtnText, {color: '#ef4444'}]}>DÉFAUT</Text>
                </TouchableOpacity>
            </View>
            <Text style={styles.helpText}>Fichier .json contenant ["Message 1", "Message 2"...]</Text>
        </View>

        {/* SECTION AUDIO & COMMS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AUDIO & COMMS</Text>
          
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Mode VOX</Text>
              <Text style={styles.settingDesc}>Transmission automatique</Text>
            </View>
            <Switch
              trackColor={{ false: "#333", true: "#22c55e" }}
              thumbColor={isVoxEnabled ? "#fff" : "#f4f3f4"}
              onValueChange={handleVoxToggle}
              value={isVoxEnabled}
            />
          </View>

          {isVoxEnabled && (
              <View style={{marginBottom: 20}}>
                   <Text style={[styles.settingDesc, {marginBottom: 10}]}>Sensibilité Micro ({voxSensitivity}%)</Text>
                   <CustomSlider value={voxSensitivity} onValueChange={handleSensitivityChange} />
              </View>
          )}

          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Haut-Parleur</Text>
              <Text style={styles.settingDesc}>Force la sortie sur le HP</Text>
            </View>
            <Switch
              trackColor={{ false: "#333", true: "#3b82f6" }}
              thumbColor={isSpeakerOn ? "#fff" : "#f4f3f4"}
              onValueChange={handleSpeakerToggle}
              value={isSpeakerOn}
            />
          </View>
        </View>

        {/* SECTION NAVIGATION (GPS) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>INTERVALLE GPS (PRÉCISION vs BATTERIE)</Text>
          <View style={styles.pillContainer}>
              {GPS_OPTIONS.map((opt) => (
                  <TouchableOpacity 
                    key={opt.val}
                    onPress={() => handleGpsChange(opt.val)}
                    style={[
                        styles.pillBtn, 
                        gpsInterval === opt.val && styles.pillBtnActive
                    ]}
                  >
                      <Text style={[
                          styles.pillText,
                          gpsInterval === opt.val && styles.pillTextActive
                      ]}>{opt.label}</Text>
                  </TouchableOpacity>
              ))}
          </View>
        </View>

        {/* SECTION VISUEL (COULEUR) */}
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>COULEUR MARQUEUR (MODE PROGRESSION)</Text>
            <View style={styles.colorGrid}>
                {COLOR_OPTIONS.map((col) => (
                    <TouchableOpacity
                        key={col.hex}
                        onPress={() => handleColorChange(col.hex)}
                        style={[
                            styles.colorCircle,
                            { backgroundColor: col.hex },
                            arrowColor === col.hex && styles.colorCircleActive
                        ]}
                    />
                ))}
            </View>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingTop: 50,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingBottom: 15,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1,
  },
  closeButton: {
    padding: 5,
  },
  content: {
    paddingHorizontal: 20,
  },
  section: {
    marginBottom: 30,
    backgroundColor: '#09090b',
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a'
  },
  sectionTitle: {
    color: '#71717a',
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 15,
    letterSpacing: 1,
    textTransform: 'uppercase'
  },
  inputContainer: {
      justifyContent: 'center'
  },
  textInput: {
      backgroundColor: '#18181b',
      color: 'white',
      padding: 15,
      borderRadius: 8,
      fontSize: 18,
      fontWeight: 'bold',
      borderWidth: 1,
      borderColor: '#3f3f46'
  },
  pillContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 10
  },
  pillBtn: {
      flex: 1,
      paddingVertical: 10,
      backgroundColor: '#18181b',
      borderRadius: 8,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#3f3f46'
  },
  pillBtnActive: {
      backgroundColor: '#2563eb',
      borderColor: '#2563eb'
  },
  pillText: {
      color: '#a1a1aa',
      fontWeight: 'bold',
      fontSize: 12
  },
  pillTextActive: {
      color: 'white'
  },
  colorGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 15,
      justifyContent: 'flex-start'
  },
  colorCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 2,
      borderColor: 'transparent'
  },
  colorCircleActive: {
      borderColor: 'white',
      borderWidth: 3,
      transform: [{scale: 1.1}]
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  settingInfo: {
    flex: 1,
    marginRight: 10,
  },
  settingLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  settingDesc: {
    color: '#888',
    fontSize: 12,
  },
  sliderContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 10
  },
  sliderBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: '#27272a',
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: '#3f3f46'
  },
  sliderTrack: {
      flex: 1,
      height: 24,
      backgroundColor: '#18181b',
      borderRadius: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: '#27272a',
      justifyContent: 'center'
  },
  sliderFill: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: '#22c55e',
      opacity: 0.3
  },
  sliderText: {
      color: 'white',
      fontSize: 10,
      fontWeight: 'bold',
      textAlign: 'center',
      zIndex: 2
  },
  // NOUVEAUX STYLES
  row: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 10
  },
  actionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: '#3b82f6',
      backgroundColor: '#18181b'
  },
  actionBtnText: {
      color: '#3b82f6',
      fontWeight: 'bold',
      fontSize: 12
  },
  helpText: {
      color: '#52525b',
      fontSize: 10,
      fontStyle: 'italic',
      textAlign: 'center'
  }
});
