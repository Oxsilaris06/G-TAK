import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Switch, Alert, ScrollView } from 'react-native';
import { AppSettings, DEFAULT_SETTINGS } from '../types';
import { configService } from '../services/configService';
import { MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

interface SettingsViewProps {
    onClose: () => void;
}

const SettingsView: React.FC<SettingsViewProps> = ({ onClose }) => {
    const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

    React.useEffect(() => {
        configService.get().then(setSettings);
    }, []);

    const save = async () => {
        await configService.update(settings);
        onClose();
    };

    const handleImportJson = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: 'application/json',
                copyToCacheDirectory: true
            });

            if (!result.canceled && result.assets && result.assets.length > 0) {
                const uri = result.assets[0].uri;
                const content = await FileSystem.readAsStringAsync(uri);
                const parsed = JSON.parse(content);

                if (Array.isArray(parsed)) {
                    // Si c'est un tableau de strings, on remplace les messages
                    const newSettings = { ...settings, quickMessages: parsed };
                    setSettings(newSettings);
                    Alert.alert("Succès", "Messages importés : " + parsed.length);
                } else if (parsed.quickMessages && Array.isArray(parsed.quickMessages)) {
                    // Si c'est un objet config complet
                    const newSettings = { ...settings, quickMessages: parsed.quickMessages };
                    setSettings(newSettings);
                    Alert.alert("Succès", "Messages importés : " + parsed.quickMessages.length);
                } else {
                    Alert.alert("Erreur", "Format JSON invalide. Attendu: ['msg1', 'msg2']");
                }
            }
        } catch (e) {
            Alert.alert("Erreur Import", "Impossible de lire le fichier.");
            console.error(e);
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>PARAMÈTRES</Text>
            </View>

            <ScrollView style={styles.content}>
                <Text style={styles.label}>IDENTIFIANT (Trigramme)</Text>
                <TextInput 
                    style={styles.input} 
                    value={settings.username} 
                    onChangeText={t => setSettings({...settings, username: t.toUpperCase()})}
                    maxLength={6}
                />

                <Text style={styles.label}>COULEUR FLÈCHE</Text>
                <View style={{flexDirection:'row', gap: 10, marginBottom: 20}}>
                    {['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#a855f7'].map(c => (
                        <TouchableOpacity 
                            key={c} 
                            onPress={() => setSettings({...settings, userArrowColor: c})}
                            style={[styles.colorBubble, {backgroundColor: c}, settings.userArrowColor === c && styles.selectedBubble]}
                        />
                    ))}
                </View>

                <Text style={styles.label}>FRÉQUENCE GPS (ms)</Text>
                <TextInput 
                    style={styles.input} 
                    value={settings.gpsUpdateInterval.toString()} 
                    keyboardType="numeric"
                    onChangeText={t => setSettings({...settings, gpsUpdateInterval: parseInt(t) || 2000})}
                />

                <Text style={styles.label}>MESSAGES RAPIDES</Text>
                <TouchableOpacity onPress={handleImportJson} style={styles.importBtn}>
                    <MaterialIcons name="file-upload" size={20} color="white" />
                    <Text style={{color:'white', fontWeight:'bold'}}>IMPORTER JSON</Text>
                </TouchableOpacity>
                <Text style={styles.hint}>Format: ["Msg1", "Msg2", ...]</Text>

                <View style={{marginTop: 10, backgroundColor: '#18181b', padding: 10, borderRadius: 8}}>
                    {settings.quickMessages.slice(0, 3).map((m, i) => (
                        <Text key={i} style={{color: '#71717a', fontSize: 12}}>• {m}</Text>
                    ))}
                    <Text style={{color: '#71717a', fontSize: 12}}>...</Text>
                </View>

            </ScrollView>

            <View style={styles.footer}>
                <TouchableOpacity onPress={onClose} style={[styles.btn, {backgroundColor: '#27272a'}]}>
                    <Text style={styles.btnText}>ANNULER</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={save} style={[styles.btn, {backgroundColor: '#3b82f6'}]}>
                    <Text style={styles.btnText}>SAUVEGARDER</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#09090b', paddingTop: 40 },
    header: { padding: 20, borderBottomWidth: 1, borderColor: '#27272a' },
    title: { color: 'white', fontSize: 20, fontWeight: 'bold' },
    content: { padding: 20 },
    label: { color: '#a1a1aa', fontSize: 12, marginBottom: 10, marginTop: 10, fontWeight: 'bold' },
    input: { backgroundColor: '#18181b', color: 'white', padding: 15, borderRadius: 8, borderWidth: 1, borderColor: '#333' },
    colorBubble: { width: 40, height: 40, borderRadius: 20 },
    selectedBubble: { borderWidth: 3, borderColor: 'white' },
    footer: { padding: 20, flexDirection: 'row', gap: 10 },
    btn: { flex: 1, padding: 15, borderRadius: 8, alignItems: 'center' },
    btnText: { color: 'white', fontWeight: 'bold' },
    importBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#27272a', padding: 15, borderRadius: 8, gap: 10, borderWidth: 1, borderColor: '#333' },
    hint: { color: '#52525b', fontSize: 10, marginTop: 5, textAlign: 'center' }
});

export default SettingsView;
