import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, Linking, Switch } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { configService } from '../services/configService';
import { AppSettings, DEFAULT_SETTINGS } from '../types';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

interface Props {
    onClose: () => void;
    onUpdate: (s: AppSettings) => void;
}

const CUSTOM_COLORS = ['#06b6d4', '#ec4899', '#8b5cf6', '#f97316'];

const SettingsView: React.FC<Props> = ({ onClose, onUpdate }) => {
    const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
    const [newMsg, setNewMsg] = useState('');

    useEffect(() => {
        setSettings(configService.get());
    }, []);

    const save = async () => {
        await configService.update(settings);
        onUpdate(settings);
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

    const handleImportJson = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
            if (!result.canceled && result.assets && result.assets.length > 0) {
                const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
                const parsed = JSON.parse(content);
                const importedMsgs = Array.isArray(parsed) ? parsed : parsed.quickMessages;
                if (importedMsgs) {
                    setSettings(s => ({...s, quickMessages: importedMsgs}));
                    Alert.alert("Succès", "Messages importés.");
                }
            }
        } catch (e) { Alert.alert("Erreur", "Fichier invalide."); }
    };

    const handlePickMapFile = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
            if (!result.canceled && result.assets && result.assets.length > 0) {
                setSettings(s => ({...s, customMapUrl: result.assets[0].uri}));
                Alert.alert("Carte", "Fichier sélectionné (Simulation MBTiles)");
            }
        } catch(e) {}
    };

    const openDoc = (file: string) => {
        Linking.openURL("https://github.com/oxsilaris06/g-tak/blob/main/" + file).catch(() => {});
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>CONFIGURATION</Text>
                <TouchableOpacity onPress={save} style={styles.closeBtn}><MaterialIcons name="check" size={24} color="white" /></TouchableOpacity>
            </View>

            <ScrollView style={styles.content}>
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>IDENTITÉ OPS</Text>
                    <View style={styles.row}>
                        <Text style={styles.label}>Trigramme</Text>
                        <TextInput style={styles.input} value={settings.username} onChangeText={t => setSettings(s => ({...s, username: t.toUpperCase()}))} maxLength={6} />
                    </View>
                    <View style={styles.row}>
                        <View>
                            <Text style={styles.label}>Couleur Progression</Text>
                            <Text style={styles.subLabel}>Affichée uniquement en mouvement</Text>
                        </View>
                        <View style={{flexDirection:'row', gap:10}}>
                            {CUSTOM_COLORS.map(c => (
                                <TouchableOpacity key={c} style={[styles.colorDot, {backgroundColor: c}, settings.userArrowColor === c && styles.colorSelected]} onPress={() => setSettings(s => ({...s, userArrowColor: c}))} />
                            ))}
                        </View>
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>SYSTÈME & CAPTEURS</Text>
                    <View style={styles.row}>
                        <View>
                             <Text style={styles.label}>GPS (Précision)</Text>
                             <Text style={styles.subLabel}>{settings.gpsUpdateInterval} ms</Text>
                        </View>
                        <View style={{flexDirection: 'row', alignItems: 'center'}}>
                            <TouchableOpacity onPress={() => setSettings(s => ({...s, gpsUpdateInterval: Math.max(1000, s.gpsUpdateInterval - 500)}))} style={styles.miniBtn}><Text style={styles.miniBtnText}>-</Text></TouchableOpacity>
                            <TouchableOpacity onPress={() => setSettings(s => ({...s, gpsUpdateInterval: s.gpsUpdateInterval + 500}))} style={styles.miniBtn}><Text style={styles.miniBtnText}>+</Text></TouchableOpacity>
                        </View>
                    </View>
                    <View style={styles.row}>
                        <View>
                             <Text style={styles.label}>Boussole</Text>
                             <Text style={styles.subLabel}>{settings.orientationUpdateInterval} ms</Text>
                        </View>
                        <View style={{flexDirection: 'row', alignItems: 'center'}}>
                            <TouchableOpacity onPress={() => setSettings(s => ({...s, orientationUpdateInterval: Math.max(100, (s.orientationUpdateInterval || 500) - 100)}))} style={styles.miniBtn}><Text style={styles.miniBtnText}>-</Text></TouchableOpacity>
                            <TouchableOpacity onPress={() => setSettings(s => ({...s, orientationUpdateInterval: Math.min(1000, (s.orientationUpdateInterval || 500) + 100)}))} style={styles.miniBtn}><Text style={styles.miniBtnText}>+</Text></TouchableOpacity>
                        </View>
                    </View>
                    
                    {/* CONFIG TRAILS */}
                    <View style={styles.row}>
                        <View>
                             <Text style={styles.label}>Historique Trails</Text>
                             <Text style={styles.subLabel}>Max points : {settings.maxTrailsPerUser}</Text>
                        </View>
                        <View style={{flexDirection: 'row', alignItems: 'center'}}>
                            <TouchableOpacity onPress={() => setSettings(s => ({...s, maxTrailsPerUser: Math.max(50, (s.maxTrailsPerUser || 500) - 50)}))} style={styles.miniBtn}><Text style={styles.miniBtnText}>-</Text></TouchableOpacity>
                            <TouchableOpacity onPress={() => setSettings(s => ({...s, maxTrailsPerUser: Math.min(1000, (s.maxTrailsPerUser || 500) + 50)}))} style={styles.miniBtn}><Text style={styles.miniBtnText}>+</Text></TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.row}>
                        <View>
                            <Text style={styles.label}>Notifs Arrière-plan</Text>
                            <Text style={styles.subLabel}>Désactiver pour économiser batterie</Text>
                        </View>
                        <Switch 
                            value={settings.disableBackgroundNotifications} 
                            onValueChange={v => setSettings(s => ({...s, disableBackgroundNotifications: v}))}
                            trackColor={{false: '#3f3f46', true: '#ef4444'}}
                        />
                    </View>
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>CARTOGRAPHIE</Text>
                    <View style={styles.row}>
                        <View>
                            <Text style={styles.label}>Source Carte Locale</Text>
                            <Text style={styles.subLabel}>{settings.customMapUrl ? "Fichier chargé" : "Aucun fichier"}</Text>
                        </View>
                        <TouchableOpacity onPress={handlePickMapFile} style={styles.importBtn}><Text style={{color:'white', fontSize: 10}}>CHARGER MBTILES</Text></TouchableOpacity>
                    </View>
                    <TextInput 
                        style={[styles.input, {width: '100%', textAlign: 'left', fontSize: 10}]} 
                        placeholder="Ou URL serveur de tuiles..." 
                        placeholderTextColor="#555"
                        value={settings.customMapUrl} 
                        onChangeText={t => setSettings(s => ({...s, customMapUrl: t}))}
                    />
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>MESSAGES RAPIDES</Text>
                    <TouchableOpacity onPress={handleImportJson} style={styles.importBtn}><MaterialIcons name="file-upload" size={20} color="white" /><Text style={{color:'white', fontWeight:'bold'}}>IMPORTER JSON</Text></TouchableOpacity>
                    <View style={styles.addRow}>
                        <TextInput style={[styles.input, {flex:1, textAlign:'left'}]} placeholder="Nouveau message..." placeholderTextColor="#52525b" value={newMsg} onChangeText={setNewMsg} />
                        <TouchableOpacity onPress={addQuickMsg} style={styles.addBtn}><MaterialIcons name="add" size={24} color="white" /></TouchableOpacity>
                    </View>
                    {settings.quickMessages?.map((msg, idx) => (
                        <View key={idx} style={styles.msgRow}>
                            <Text style={styles.msgText}>{msg}</Text>
                            <TouchableOpacity onPress={() => removeQuickMsg(idx)}><MaterialIcons name="delete" size={20} color="#ef4444" /></TouchableOpacity>
                        </View>
                    ))}
                </View>

                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>À PROPOS</Text>
                    <TouchableOpacity onPress={() => openDoc('PRIVACY.md')} style={styles.linkRow}><Text style={styles.linkText}>Politique de Confidentialité</Text><MaterialIcons name="open-in-new" size={20} color="#3b82f6" /></TouchableOpacity>
                </View>

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
    subLabel: { color: '#52525b', fontSize: 10, maxWidth: 150 },
    input: { backgroundColor: '#27272a', color: 'white', padding: 8, borderRadius: 8, minWidth: 100, textAlign: 'center' },
    colorDot: { width: 30, height: 30, borderRadius: 15 },
    colorSelected: { borderWidth: 2, borderColor: 'white' },
    miniBtn: { backgroundColor: '#27272a', width: 30, height: 30, justifyContent: 'center', alignItems: 'center', borderRadius: 15, marginLeft: 5 },
    miniBtnText: { color: 'white', fontSize: 18 },
    addRow: { flexDirection: 'row', gap: 10, marginBottom: 15 },
    addBtn: { backgroundColor: '#2563eb', width: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
    msgRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#27272a' },
    msgText: { color: '#d4d4d8' },
    importBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#27272a', padding: 12, borderRadius: 8, gap: 10, borderWidth: 1, borderColor: '#333', marginBottom: 15 },
    linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
    linkText: { color: 'white', fontSize: 16 }
});

export default SettingsView;
