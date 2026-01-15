import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { configService } from '../services/configService';
import { AppSettings, DEFAULT_SETTINGS } from '../types';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

interface Props {
    onClose: () => void;
}

const SettingsView: React.FC<Props> = ({ onClose }) => {
    const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
    const [newMsg, setNewMsg] = useState('');

    useEffect(() => {
        setSettings(configService.get());
    }, []);

    const save = async () => {
        await configService.update(settings);
        onClose();
    };

    const addQuickMsg = () => {
        if (!newMsg.trim()) return;
        setSettings(prev => ({
            ...prev,
            quickMessages: [...(prev.quickMessages || []), newMsg.trim()]
        }));
        setNewMsg('');
    };

    const removeQuickMsg = (index: number) => {
        const newList = [...settings.quickMessages];
        newList.splice(index, 1);
        setSettings(prev => ({ ...prev, quickMessages: newList }));
    };

    const resetDefaults = () => {
        Alert.alert("Réinitialiser", "Restaurer les paramètres par défaut ?", [
            { text: "Annuler" },
            { text: "Oui", onPress: () => setSettings(DEFAULT_SETTINGS) }
        ]);
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
                
                try {
                    const parsed = JSON.parse(content);
                    let importedMsgs: string[] = [];

                    // On accepte soit un tableau direct, soit un objet avec la clé quickMessages
                    if (Array.isArray(parsed)) {
                        importedMsgs = parsed.filter(item => typeof item === 'string');
                    } else if (parsed.quickMessages && Array.isArray(parsed.quickMessages)) {
                        importedMsgs = parsed.quickMessages.filter((item: any) => typeof item === 'string');
                    }

                    if (importedMsgs.length > 0) {
                        // MISE A JOUR ET SAUVEGARDE IMMEDIATE
                        const updatedSettings = { ...settings, quickMessages: importedMsgs };
                        setSettings(updatedSettings);
                        await configService.update(updatedSettings);
                        Alert.alert("Succès", `${importedMsgs.length} messages importés et sauvegardés.`);
                    } else {
                        Alert.alert("Erreur", "Aucun message valide trouvé dans le fichier.");
                    }
                } catch (jsonError) {
                    Alert.alert("Erreur JSON", "Format de fichier invalide.");
                }
            }
        } catch (e) {
            Alert.alert("Erreur Import", "Impossible de lire le fichier.");
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>CONFIGURATION</Text>
                <TouchableOpacity onPress={save} style={styles.closeBtn}>
                    <MaterialIcons name="check" size={24} color="white" />
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.content}>
                
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>IDENTITÉ OPS</Text>
                    <View style={styles.row}>
                        <Text style={styles.label}>Trigramme</Text>
                        <TextInput 
                            style={styles.input} 
                            value={settings.username} 
                            onChangeText={t => setSettings(s => ({...s, username: t.toUpperCase()}))}
                            maxLength={6}
                        />
                    </View>
                    <View style={styles.row}>
                        <Text style={styles.label}>Couleur Position</Text>
                        <View style={{flexDirection:'row', gap:10}}>
                            {['#3b82f6', '#ef4444', '#22c55e', '#eab308'].map(c => (
                                <TouchableOpacity 
                                    key={c}
                                    style={[styles.colorDot, {backgroundColor: c}, settings.userArrowColor === c && styles.colorSelected]}
                                    onPress={() => setSettings(s => ({...s, userArrowColor: c}))}
                                />
                            ))}
                        </View>
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>GPS & BATTERIE</Text>
                    <View style={styles.row}>
                        <View>
                             <Text style={styles.label}>Intervalle Mise à Jour</Text>
                             <Text style={styles.subLabel}>Plus court = Plus précis mais consomme plus</Text>
                        </View>
                        <View style={{flexDirection: 'row', alignItems: 'center'}}>
                            <TouchableOpacity onPress={() => setSettings(s => ({...s, gpsUpdateInterval: Math.max(1000, s.gpsUpdateInterval - 1000)}))} style={styles.miniBtn}><Text style={styles.miniBtnText}>-</Text></TouchableOpacity>
                            <Text style={styles.valueText}>{settings.gpsUpdateInterval / 1000}s</Text>
                            <TouchableOpacity onPress={() => setSettings(s => ({...s, gpsUpdateInterval: s.gpsUpdateInterval + 1000}))} style={styles.miniBtn}><Text style={styles.miniBtnText}>+</Text></TouchableOpacity>
                        </View>
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>MESSAGES PRÉDÉFINIS</Text>
                    
                    <TouchableOpacity onPress={handleImportJson} style={styles.importBtn}>
                        <MaterialIcons name="file-upload" size={20} color="white" />
                        <Text style={{color:'white', fontWeight:'bold'}}>IMPORTER JSON</Text>
                    </TouchableOpacity>
                    
                    <View style={styles.addRow}>
                        <TextInput 
                            style={[styles.input, {flex:1, textAlign:'left'}]} 
                            placeholder="Nouveau message..." 
                            placeholderTextColor="#52525b"
                            value={newMsg}
                            onChangeText={setNewMsg}
                        />
                        <TouchableOpacity onPress={addQuickMsg} style={styles.addBtn}>
                            <MaterialIcons name="add" size={24} color="white" />
                        </TouchableOpacity>
                    </View>
                    {settings.quickMessages?.map((msg, idx) => (
                        <View key={idx} style={styles.msgRow}>
                            <Text style={styles.msgText}>{msg}</Text>
                            <TouchableOpacity onPress={() => removeQuickMsg(idx)}>
                                <MaterialIcons name="delete" size={20} color="#ef4444" />
                            </TouchableOpacity>
                        </View>
                    ))}
                </View>

                <TouchableOpacity onPress={resetDefaults} style={styles.resetBtn}>
                    <Text style={styles.resetText}>RESTAURER DÉFAUTS</Text>
                </TouchableOpacity>
                
                <View style={{height: 100}} /> 
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#09090b', paddingTop: 40 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#27272a' },
    title: { color: 'white', fontSize: 20, fontWeight: 'bold' },
    closeBtn: { backgroundColor: '#2563eb', padding: 10, borderRadius: 8 },
    content: { padding: 20 },
    section: { marginBottom: 30, backgroundColor: '#18181b', borderRadius: 12, padding: 15 },
    sectionTitle: { color: '#71717a', fontSize: 12, fontWeight: 'bold', marginBottom: 15, letterSpacing: 1 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
    label: { color: 'white', fontSize: 16 },
    subLabel: { color: '#52525b', fontSize: 10 },
    input: { backgroundColor: '#27272a', color: 'white', padding: 8, borderRadius: 8, minWidth: 100, textAlign: 'center' },
    colorDot: { width: 30, height: 30, borderRadius: 15 },
    colorSelected: { borderWidth: 2, borderColor: 'white' },
    miniBtn: { backgroundColor: '#27272a', width: 30, height: 30, justifyContent: 'center', alignItems: 'center', borderRadius: 15 },
    miniBtnText: { color: 'white', fontSize: 18 },
    valueText: { color: 'white', marginHorizontal: 10, width: 30, textAlign: 'center' },
    addRow: { flexDirection: 'row', gap: 10, marginBottom: 15 },
    addBtn: { backgroundColor: '#2563eb', width: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
    msgRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#27272a' },
    msgText: { color: '#d4d4d8' },
    resetBtn: { padding: 15, alignItems: 'center', borderWidth: 1, borderColor: '#ef4444', borderRadius: 12, marginBottom: 20 },
    resetText: { color: '#ef4444', fontWeight: 'bold' },
    importBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#27272a', padding: 12, borderRadius: 8, gap: 10, borderWidth: 1, borderColor: '#333', marginBottom: 15 }
});

export default SettingsView;
