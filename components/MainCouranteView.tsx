import React, { useState, useEffect, useRef } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, 
  Modal, Alert, KeyboardAvoidingView, Platform, ScrollView 
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LogEntry, OperatorRole } from '../types';
import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

interface Props {
    visible: boolean;
    logs: LogEntry[];
    role: OperatorRole;
    onClose: () => void;
    onAddLog: (entry: LogEntry) => void;
    onUpdateLog?: (entry: LogEntry) => void; 
    onDeleteLog: (id: string) => void;
}

const PAX_TYPES = [
    { label: 'HOSTILE', color: '#be1b09', textColor: '#ffffff' },
    { label: 'CIVIL/OTAGE', color: '#f1c40f', textColor: '#000000' },
    { label: 'INTER', color: '#3498db', textColor: '#ffffff' },
    { label: 'ALLIÉ', color: '#22c55e', textColor: '#000000' },
    { label: 'AUTRE', color: '#9ca3af', textColor: '#000000' }
];

const generateHtml = (logs: LogEntry[]) => {
  const dateStr = new Date().toLocaleDateString('fr-FR');
  const rows = logs.map(l => `
    <tr>
      <td style="color: #3b82f6; font-weight: bold;">${l.heure}</td>
      <td>
        <span style="background-color: ${l.paxColor}; color: ${l.paxColor === '#f1c40f' ? 'black' : 'white'}; padding: 2px 6px; border-radius: 4px; font-weight: bold; font-size: 10px;">
          ${l.pax}
        </span>
      </td>
      <td>${l.lieu || '-'}</td>
      <td style="font-weight: bold;">${l.action || '-'}</td>
      <td style="font-style: italic; color: #555;">${l.remarques || ''}</td>
    </tr>
  `).join('');

  return `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: 'Helvetica', sans-serif; padding: 20px; }
          h1 { text-align: center; border-bottom: 3px solid #333; padding-bottom: 10px; margin-bottom: 5px; }
          .sub { text-align: center; color: #666; margin-bottom: 30px; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th { background-color: #eee; text-align: left; padding: 8px; border-bottom: 2px solid #ddd; }
          td { padding: 8px; border-bottom: 1px solid #eee; vertical-align: top; }
          tr:nth-child(even) { background-color: #f9f9f9; }
        </style>
      </head>
      <body>
        <h1>PC TAC ${dateStr}</h1>
        <div class="sub">RAPPORT DE SITUATION - PRAXIS</div>
        <table>
          <thead>
            <tr>
              <th width="10%">H</th>
              <th width="15%">PAX</th>
              <th width="20%">LIEU</th>
              <th width="25%">ACTION</th>
              <th width="30%">REMARQUES</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `;
};

const MainCouranteView: React.FC<Props> = ({ visible, logs, role, onClose, onAddLog, onUpdateLog, onDeleteLog }) => {
    // Form States
    const [paxType, setPaxType] = useState(PAX_TYPES[2]);
    const [customPax, setCustomPax] = useState('');
    const [lieu, setLieu] = useState('');
    const [action, setAction] = useState('');
    const [remarques, setRemarques] = useState('');
    const [manualTime, setManualTime] = useState('');
    
    // Edit States
    const [editingLog, setEditingLog] = useState<LogEntry | null>(null);
    
    // QR Export logic removed for brevity as per request focus on fixes
    
    const listRef = useRef<FlatList>(null);
    const isHost = role === OperatorRole.HOST;

    useEffect(() => {
        if (visible) updateManualTime();
    }, [visible]);

    // Effet pour pré-remplir le formulaire lors de l'édition
    useEffect(() => {
        if (editingLog) {
            setManualTime(editingLog.heure);
            setLieu(editingLog.lieu);
            setAction(editingLog.action);
            setRemarques(editingLog.remarques);
            
            // Retrouver le type PAX ou mettre en custom
            const foundType = PAX_TYPES.find(t => t.color === editingLog.paxColor);
            if (foundType) {
                setPaxType(foundType);
                if (editingLog.pax !== foundType.label) setCustomPax(editingLog.pax);
                else setCustomPax('');
            } else {
                setPaxType(PAX_TYPES[4]); // Autre
                setCustomPax(editingLog.pax);
            }
        } else {
            // Reset form
            resetForm();
        }
    }, [editingLog]);

    const updateManualTime = () => {
        const now = new Date();
        setManualTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    };

    const resetForm = () => {
        setLieu('');
        setAction('');
        setRemarques('');
        setCustomPax('');
        setPaxType(PAX_TYPES[2]);
        updateManualTime();
    };

    const handleSubmit = () => {
        if (!action.trim() && !remarques.trim() && !lieu.trim()) {
            Alert.alert("Erreur", "Remplissez au moins un champ.");
            return;
        }

        const entryData: LogEntry = {
            id: editingLog ? editingLog.id : Math.random().toString(36).substring(2, 9),
            heure: manualTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            pax: customPax.trim() || paxType.label,
            paxColor: paxType.color,
            lieu: lieu.trim(),
            action: action.trim(),
            remarques: remarques.trim()
        };

        if (editingLog && onUpdateLog) {
            onUpdateLog(entryData);
            setEditingLog(null); // Sortie du mode édition
        } else {
            onAddLog(entryData);
            setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
        }

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        resetForm();
    };

    const handleStartEdit = (log: LogEntry) => {
        if (!isHost) return;
        setEditingLog({ ...log }); 
        Haptics.selectionAsync();
    };

    const handleCancelEdit = () => {
        setEditingLog(null);
        resetForm();
    };

    const handleExportPDF = async () => {
        try {
            const html = generateHtml(logs);
            const dateStr = new Date().toISOString().split('T')[0];
            const { uri } = await Print.printToFileAsync({ html, name: `Rapport-${dateStr}` });
            await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
        } catch (error) { Alert.alert("Erreur PDF", "Impossible de générer le fichier."); }
    };

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
                        <Text style={styles.headerSubtitle}>{logs.length} Entrées • {isHost ? (editingLog ? 'MODIFICATION' : 'ÉDITION') : 'LECTURE'}</Text>
                    </View>
                    <TouchableOpacity onPress={handleExportPDF} style={styles.shareBtn}>
                        <MaterialIcons name="picture-as-pdf" size={24} color="#ef4444" />
                    </TouchableOpacity>
                </View>

                {/* LISTE DES LOGS */}
                <FlatList
                    ref={listRef}
                    data={logs}
                    keyExtractor={item => item.id}
                    contentContainerStyle={{ padding: 16, paddingBottom: 280 }} // Increased paddingBottom for the form
                    renderItem={({ item }) => (
                        <TouchableOpacity 
                            style={[styles.logRow, editingLog?.id === item.id && { borderColor: '#eab308', borderWidth: 1 }]} 
                            onLongPress={() => handleStartEdit(item)}
                            activeOpacity={0.8}
                        >
                            <View style={styles.timeCol}>
                                <Text style={styles.timeText}>{item.heure}</Text>
                            </View>
                            <View style={styles.contentCol}>
                                <View style={styles.topRow}>
                                    <View style={[styles.paxBadge, { backgroundColor: item.paxColor }]}>
                                        <Text style={[styles.paxText, { color: item.paxColor === '#f1c40f' ? 'black' : 'white' }]}>{item.pax}</Text>
                                    </View>
                                    {item.lieu ? <Text style={styles.lieuText}>📍 {item.lieu}</Text> : null}
                                </View>
                                {item.action ? <Text style={styles.actionText}>{item.action}</Text> : null}
                                {item.remarques ? <Text style={styles.remarquesText}>📝 {item.remarques}</Text> : null}
                            </View>
                            {isHost && (
                                <View style={{justifyContent: 'space-between'}}>
                                    <TouchableOpacity onPress={() => handleStartEdit(item)} style={styles.actionBtn}>
                                        <MaterialIcons name="edit" size={18} color="#a1a1aa" />
                                    </TouchableOpacity>
                                    <TouchableOpacity onPress={() => onDeleteLog(item.id)} style={styles.actionBtn}>
                                        <MaterialIcons name="delete-outline" size={18} color="#ef4444" />
                                    </TouchableOpacity>
                                </View>
                            )}
                        </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <MaterialIcons name="history-edu" size={48} color="#333" />
                            <Text style={styles.emptyText}>Journal vide.</Text>
                        </View>
                    }
                />

                {/* FORMULAIRE (Unique pour Ajout ET Modification) */}
                {isHost && (
                    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.formWrapper}>
                        <View style={[styles.formContainer, editingLog && { borderColor: '#eab308', borderWidth: 1 }]}>
                            <View style={styles.formHeader}>
                                <Text style={[styles.formLabel, editingLog && {color: '#eab308'}]}>
                                    {editingLog ? 'MODIFICATION ENTRÉE' : 'NOUVELLE ENTRÉE'}
                                </Text>
                                <View style={{flexDirection: 'row', alignItems: 'center'}}>
                                    {editingLog && (
                                        <TouchableOpacity onPress={handleCancelEdit} style={{marginRight: 10, padding: 4}}>
                                            <Text style={{color: '#ef4444', fontSize: 10, fontWeight:'bold'}}>ANNULER</Text>
                                        </TouchableOpacity>
                                    )}
                                    <MaterialIcons name="access-time" size={14} color="#555" style={{marginRight: 4}}/>
                                    <TextInput 
                                        style={styles.timeInput} 
                                        value={manualTime} 
                                        onChangeText={setManualTime} 
                                        placeholder="HH:MM"
                                        placeholderTextColor="#555"
                                    />
                                </View>
                            </View>

                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroller}>
                                {PAX_TYPES.map((t, idx) => (
                                    <TouchableOpacity 
                                        key={idx} 
                                        style={[styles.typeBtn, paxType.label === t.label && styles.typeBtnSelected, { borderColor: t.color, backgroundColor: paxType.label === t.label ? t.color : 'transparent' }]} 
                                        onPress={() => { setPaxType(t); setCustomPax(''); }}
                                    >
                                        <Text style={[styles.typeBtnText, { color: paxType.label === t.label ? (t.color === '#f1c40f' ? 'black' : 'white') : t.color }]}>{t.label}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>

                            <View style={styles.inputRow}>
                                <TextInput style={[styles.input, { flex: 1 }]} placeholder="Lieu..." placeholderTextColor="#52525b" value={lieu} onChangeText={setLieu} />
                                <TextInput style={[styles.input, { flex: 1.5 }]} placeholder="Action / Événement" placeholderTextColor="#52525b" value={action} onChangeText={setAction} />
                            </View>
                            
                            <View style={styles.inputRow}>
                                <TextInput style={[styles.input, { flex: 1 }]} placeholder="Remarques..." placeholderTextColor="#52525b" value={remarques} onChangeText={setRemarques} />
                                <TouchableOpacity onPress={handleSubmit} style={[styles.submitBtn, editingLog && {backgroundColor: '#eab308'}]}>
                                    <MaterialIcons name={editingLog ? "check" : "send"} size={24} color={editingLog ? "black" : "white"} />
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
    actionBtn: { padding: 5 },

    emptyContainer: { alignItems: 'center', marginTop: 50, opacity: 0.5 },
    emptyText: { color: '#52525b', marginTop: 10 },

    formWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0 },
    formContainer: { backgroundColor: '#141415', padding: 16, borderTopWidth: 1, borderTopColor: '#333', paddingBottom: Platform.OS === 'ios' ? 40 : 16 },
    formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
    formLabel: { color: '#71717a', fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
    timeInput: { color: '#3b82f6', fontWeight: 'bold', backgroundColor: '#000', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 4, textAlign: 'center', minWidth: 50, fontSize: 12 },
    
    typeScroller: { flexDirection: 'row', marginBottom: 10, maxHeight: 40 },
    typeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15, borderWidth: 1, marginRight: 8, justifyContent: 'center' },
    typeBtnSelected: { },
    typeBtnText: { fontSize: 10, fontWeight: 'bold' },

    inputRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
    input: { backgroundColor: '#000', color: 'white', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#333', fontSize: 14 },
    submitBtn: { backgroundColor: '#3b82f6', width: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 8, padding: 10 },
});

export default MainCouranteView;
