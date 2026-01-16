import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, Modal, Share, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LogEntry, OperatorRole } from '../types';
import * as Haptics from 'expo-haptics';

interface Props {
    visible: boolean;
    logs: LogEntry[];
    role: OperatorRole;
    onClose: () => void;
    onAddLog: (entry: LogEntry) => void;
    onDeleteLog: (id: string) => void;
}

// Couleurs prédéfinies inspirées de PcTac
const PAX_TYPES = [
    { label: 'HOSTILE', color: '#be1b09', textColor: '#ffffff' },
    { label: 'CIVIL/OTAGE', color: '#f1c40f', textColor: '#000000' },
    { label: 'INTER', color: '#3498db', textColor: '#ffffff' },
    { label: 'ALLIÉ', color: '#22c55e', textColor: '#000000' },
    { label: 'AUTRE', color: '#9ca3af', textColor: '#000000' }
];

const MainCouranteView: React.FC<Props> = ({ visible, logs, role, onClose, onAddLog, onDeleteLog }) => {
    // Form States
    const [paxType, setPaxType] = useState(PAX_TYPES[2]); // Default INTER
    const [customPax, setCustomPax] = useState('');
    const [lieu, setLieu] = useState('');
    const [action, setAction] = useState('');
    const [remarques, setRemarques] = useState('');
    const [manualTime, setManualTime] = useState('');

    const listRef = useRef<FlatList>(null);

    // Initialiser l'heure manuelle à l'ouverture
    useEffect(() => {
        if (visible) {
            const now = new Date();
            setManualTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
        }
    }, [visible]);

    const handleAdd = () => {
        if (!action.trim() && !remarques.trim()) {
            Alert.alert("Erreur", "L'action ou une remarque est requise.");
            return;
        }

        const newEntry: LogEntry = {
            id: Math.random().toString(36).substring(2, 9),
            heure: manualTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            pax: customPax.trim() || paxType.label,
            paxColor: paxType.color,
            lieu: lieu.trim(),
            action: action.trim(),
            remarques: remarques.trim()
        };

        onAddLog(newEntry);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        // Reset partiel pour faciliter la saisie en chaîne
        setAction('');
        setRemarques('');
        // On garde le lieu et le pax car souvent identiques dans une séquence
        
        // Update time for next entry
        const now = new Date();
        setManualTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
        
        // Scroll to bottom
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    };

    const handleShare = async () => {
        const text = logs.map(l => `[${l.heure}] ${l.pax} @ ${l.lieu || 'N/A'} : ${l.action} ${l.remarques ? '('+l.remarques+')' : ''}`).join('\n');
        try {
            await Share.share({ message: `MAIN COURANTE TACTIQUE\n\n${text}` });
        } catch (error) {
            console.error(error);
        }
    };

    const isHost = role === OperatorRole.HOST;

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View style={styles.container}>
                {/* HEADER */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                        <MaterialIcons name="close" size={24} color="#a1a1aa" />
                    </TouchableOpacity>
                    <View style={styles.headerTitleContainer}>
                        <Text style={styles.headerTitle}>MAIN COURANTE</Text>
                        <Text style={styles.headerSubtitle}>{logs.length} Entrées • {isHost ? 'ÉDITION' : 'LECTURE SEULE'}</Text>
                    </View>
                    <TouchableOpacity onPress={handleShare} style={styles.shareBtn}>
                        <MaterialIcons name="share" size={24} color="#3b82f6" />
                    </TouchableOpacity>
                </View>

                {/* LISTE DES LOGS */}
                <FlatList
                    ref={listRef}
                    data={logs}
                    keyExtractor={item => item.id}
                    contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
                    renderItem={({ item }) => (
                        <View style={styles.logRow}>
                            <View style={styles.timeCol}>
                                <Text style={styles.timeText}>{item.heure}</Text>
                            </View>
                            <View style={styles.contentCol}>
                                <View style={styles.topRow}>
                                    <View style={[styles.paxBadge, { backgroundColor: item.paxColor }]}>
                                        <Text style={styles.paxText}>{item.pax}</Text>
                                    </View>
                                    {item.lieu ? <Text style={styles.lieuText}>📍 {item.lieu}</Text> : null}
                                </View>
                                <Text style={styles.actionText}>{item.action}</Text>
                                {item.remarques ? <Text style={styles.remarquesText}>📝 {item.remarques}</Text> : null}
                            </View>
                            {isHost && (
                                <TouchableOpacity onPress={() => onDeleteLog(item.id)} style={styles.deleteBtn}>
                                    <MaterialIcons name="delete-outline" size={20} color="#ef4444" />
                                </TouchableOpacity>
                            )}
                        </View>
                    )}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <MaterialIcons name="history-edu" size={48} color="#333" />
                            <Text style={styles.emptyText}>Aucune entrée dans le journal.</Text>
                        </View>
                    }
                />

                {/* FORMULAIRE (HOST ONLY) */}
                {isHost && (
                    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}>
                        <View style={styles.formContainer}>
                            <View style={styles.formHeader}>
                                <Text style={styles.formLabel}>NOUVELLE ENTRÉE</Text>
                                <TextInput 
                                    style={styles.timeInput} 
                                    value={manualTime} 
                                    onChangeText={setManualTime} 
                                    placeholder="HH:MM"
                                    placeholderTextColor="#555"
                                    keyboardType="numbers-and-punctuation"
                                />
                            </View>

                            {/* SÉLECTEUR DE TYPE */}
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroller}>
                                {PAX_TYPES.map((t, idx) => (
                                    <TouchableOpacity 
                                        key={idx} 
                                        style={[styles.typeBtn, paxType.label === t.label && styles.typeBtnSelected, { borderColor: t.color }]} 
                                        onPress={() => { setPaxType(t); setCustomPax(''); }}
                                    >
                                        <Text style={[styles.typeBtnText, { color: t.color }]}>{t.label}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>

                            <View style={styles.inputRow}>
                                <TextInput style={[styles.input, { flex: 1 }]} placeholder="Lieu (Salon, Toit...)" placeholderTextColor="#52525b" value={lieu} onChangeText={setLieu} />
                                <TextInput style={[styles.input, { flex: 1.5 }]} placeholder="Action / Événement" placeholderTextColor="#52525b" value={action} onChangeText={setAction} />
                            </View>
                            
                            <View style={styles.inputRow}>
                                <TextInput style={[styles.input, { flex: 1 }]} placeholder="Remarques..." placeholderTextColor="#52525b" value={remarques} onChangeText={setRemarques} />
                                <TouchableOpacity onPress={handleAdd} style={styles.submitBtn}>
                                    <MaterialIcons name="send" size={24} color="white" />
                                </TouchableOpacity>
                            </View>
                        </View>
                    </KeyboardAvoidingView>
                )}
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#09090b' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#27272a', backgroundColor: '#18181b' },
    closeBtn: { padding: 8 },
    shareBtn: { padding: 8 },
    headerTitleContainer: { alignItems: 'center' },
    headerTitle: { color: 'white', fontWeight: '900', fontSize: 16, letterSpacing: 1 },
    headerSubtitle: { color: '#71717a', fontSize: 10, fontWeight: 'bold' },
    
    logRow: { flexDirection: 'row', backgroundColor: '#18181b', marginBottom: 8, padding: 12, borderRadius: 8, borderLeftWidth: 3, borderLeftColor: '#3b82f6' },
    timeCol: { width: 50, marginRight: 10, justifyContent: 'flex-start' },
    timeText: { color: '#3b82f6', fontWeight: 'bold', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
    contentCol: { flex: 1 },
    topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 8 },
    paxBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    paxText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
    lieuText: { color: '#a1a1aa', fontSize: 11, fontWeight: 'bold' },
    actionText: { color: '#e4e4e7', fontSize: 14, fontWeight: '500' },
    remarquesText: { color: '#71717a', fontSize: 12, fontStyle: 'italic', marginTop: 2 },
    deleteBtn: { padding: 5, justifyContent: 'center' },

    emptyContainer: { alignItems: 'center', marginTop: 50, opacity: 0.5 },
    emptyText: { color: '#52525b', marginTop: 10 },

    formContainer: { backgroundColor: '#18181b', padding: 16, borderTopWidth: 1, borderTopColor: '#333' },
    formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    formLabel: { color: '#71717a', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
    timeInput: { color: '#3b82f6', fontWeight: 'bold', backgroundColor: '#000', padding: 4, borderRadius: 4, textAlign: 'center', minWidth: 60 },
    
    typeScroller: { flexDirection: 'row', marginBottom: 10, maxHeight: 40 },
    typeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 15, borderWidth: 1, marginRight: 8, backgroundColor: 'rgba(0,0,0,0.3)' },
    typeBtnSelected: { backgroundColor: 'rgba(255,255,255,0.1)' },
    typeBtnText: { fontSize: 10, fontWeight: 'bold' },

    inputRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
    input: { backgroundColor: '#000', color: 'white', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#333', fontSize: 14 },
    submitBtn: { backgroundColor: '#3b82f6', width: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
});

export default MainCouranteView;
