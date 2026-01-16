import React, { useState, useEffect, useRef } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, 
  Modal, Share, Alert, KeyboardAvoidingView, Platform, ScrollView, 
  Dimensions 
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LogEntry, OperatorRole } from '../types';
import * as Haptics from 'expo-haptics';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import QRCode from 'react-native-qrcode-svg';

interface Props {
    visible: boolean;
    logs: LogEntry[];
    role: OperatorRole;
    onClose: () => void;
    onAddLog: (entry: LogEntry) => void;
    onDeleteLog: (id: string) => void;
}

const SCREEN_WIDTH = Dimensions.get('window').width;

const PAX_TYPES = [
    { label: 'HOSTILE', color: '#be1b09', textColor: '#ffffff' },
    { label: 'CIVIL/OTAGE', color: '#f1c40f', textColor: '#000000' },
    { label: 'INTER', color: '#3498db', textColor: '#ffffff' },
    { label: 'ALLIÉ', color: '#22c55e', textColor: '#000000' },
    { label: 'AUTRE', color: '#9ca3af', textColor: '#000000' }
];

// --- TEMPLATE HTML POUR LE PDF ---
const generateHtml = (logs: LogEntry[]) => {
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
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; }
          h1 { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; }
          .meta { margin-bottom: 20px; font-size: 12px; color: #666; text-align: right; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { background-color: #eee; text-align: left; padding: 8px; border-bottom: 2px solid #ddd; }
          td { padding: 8px; border-bottom: 1px solid #eee; vertical-align: top; }
          tr:nth-child(even) { background-color: #f9f9f9; }
        </style>
      </head>
      <body>
        <h1>MAIN COURANTE TACTIQUE</h1>
        <div class="meta">Généré le: ${new Date().toLocaleString()} | Entrées: ${logs.length}</div>
        <table>
          <thead>
            <tr>
              <th width="10%">HEURE</th>
              <th width="15%">PAX</th>
              <th width="20%">LIEU</th>
              <th width="25%">ACTION</th>
              <th width="30%">REMARQUES</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </body>
    </html>
  `;
};

const MainCouranteView: React.FC<Props> = ({ visible, logs, role, onClose, onAddLog, onDeleteLog }) => {
    const [paxType, setPaxType] = useState(PAX_TYPES[2]);
    const [customPax, setCustomPax] = useState('');
    const [lieu, setLieu] = useState('');
    const [action, setAction] = useState('');
    const [remarques, setRemarques] = useState('');
    const [manualTime, setManualTime] = useState('');
    const listRef = useRef<FlatList>(null);

    // --- QR EXPORT STATES ---
    const [showQrExport, setShowQrExport] = useState(false);
    const [qrChunks, setQrChunks] = useState<string[]>([]);
    const [currentQrIndex, setCurrentQrIndex] = useState(0);

    useEffect(() => {
        if (visible) updateManualTime();
    }, [visible]);

    const updateManualTime = () => {
        const now = new Date();
        setManualTime(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    };

    const handleAdd = () => {
        if (!action.trim() && !remarques.trim() && !lieu.trim()) {
            Alert.alert("Erreur", "Remplissez au moins un champ.");
            return;
        }

        const newEntry: LogEntry = {
            id: Math.random().toString(36).substring(2, 9),
            heure: manualTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            pax: customPax.trim() || paxType.label,
            paxColor: paxType.color,
            paxMode: customPax.trim() ? 'free' : 'standard',
            lieu: lieu.trim(),
            action: action.trim(),
            remarques: remarques.trim()
        };

        onAddLog(newEntry);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setAction('');
        setRemarques('');
        updateManualTime();
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    };

    // --- PDF GENERATION ---
    const handleExportPDF = async () => {
        try {
            const html = generateHtml(logs);
            const { uri } = await Print.printToFileAsync({ html });
            if (Platform.OS === "ios") {
                await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
            } else {
                await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Exporter Main Courante' });
            }
        } catch (error) {
            Alert.alert("Erreur PDF", "Impossible de générer le fichier.");
            console.error(error);
        }
    };

    // --- QR CODE CHUNKING LOGIC (Similaire à PcTac.tsx) ---
    const prepareQrExport = () => {
        const data = JSON.stringify(logs);
        // On découpe en morceaux de 600 caractères pour assurer une bonne lisibilité
        const CHUNK_SIZE = 600;
        const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
        const chunks: string[] = [];

        // Header format: " TacSuiteLog | index | total | data "
        for (let i = 0; i < totalChunks; i++) {
            const chunkData = data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            chunks.push(`TacLogs|${i + 1}|${totalChunks}|${chunkData}`);
        }

        setQrChunks(chunks);
        setCurrentQrIndex(0);
        setShowQrExport(true);
    };

    const handleNextQr = () => {
        if (currentQrIndex < qrChunks.length - 1) {
            setCurrentQrIndex(prev => prev + 1);
        } else {
            setCurrentQrIndex(0); // Loop
        }
    };

    const handlePrevQr = () => {
        if (currentQrIndex > 0) {
            setCurrentQrIndex(prev => prev - 1);
        } else {
            setCurrentQrIndex(qrChunks.length - 1); // Loop back
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
                        <Text style={styles.headerSubtitle}>{logs.length} Entrées • {isHost ? 'ÉDITION' : 'LECTURE'}</Text>
                    </View>
                    <View style={{flexDirection: 'row', gap: 10}}>
                        <TouchableOpacity onPress={handleExportPDF} style={styles.shareBtn}>
                            <MaterialIcons name="picture-as-pdf" size={24} color="#ef4444" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={prepareQrExport} style={styles.shareBtn}>
                            <MaterialIcons name="qr-code-2" size={24} color="#3b82f6" />
                        </TouchableOpacity>
                    </View>
                </View>

                {/* LISTE DES LOGS */}
                <FlatList
                    ref={listRef}
                    data={logs}
                    keyExtractor={item => item.id}
                    contentContainerStyle={{ padding: 16, paddingBottom: 250 }}
                    renderItem={({ item }) => (
                        <View style={styles.logRow}>
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
                                <TouchableOpacity onPress={() => onDeleteLog(item.id)} style={styles.deleteBtn}>
                                    <MaterialIcons name="delete-outline" size={20} color="#ef4444" />
                                </TouchableOpacity>
                            )}
                        </View>
                    )}
                    ListEmptyComponent={
                        <View style={styles.emptyContainer}>
                            <MaterialIcons name="history-edu" size={48} color="#333" />
                            <Text style={styles.emptyText}>Journal vide.</Text>
                        </View>
                    }
                />

                {/* FORMULAIRE (HOST ONLY) */}
                {isHost && (
                    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.formWrapper}>
                        <View style={styles.formContainer}>
                            <View style={styles.formHeader}>
                                <Text style={styles.formLabel}>NOUVELLE ENTRÉE</Text>
                                <View style={{flexDirection: 'row', alignItems: 'center'}}>
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
                                <TouchableOpacity onPress={handleAdd} style={styles.submitBtn}>
                                    <MaterialIcons name="send" size={24} color="white" />
                                </TouchableOpacity>
                            </View>
                        </View>
                    </KeyboardAvoidingView>
                )}

                {/* MODAL EXPORT QR SUCCESSIF */}
                <Modal visible={showQrExport} transparent animationType="fade">
                    <View style={styles.modalOverlay}>
                        <View style={styles.qrModalContent}>
                            <Text style={styles.modalTitle}>EXPORT DATA GAP</Text>
                            <Text style={styles.qrCounter}>QR {currentQrIndex + 1} / {qrChunks.length}</Text>
                            
                            <View style={styles.qrContainer}>
                                {qrChunks.length > 0 && (
                                    <QRCode value={qrChunks[currentQrIndex]} size={200} backgroundColor="white" />
                                )}
                            </View>
                            
                            <Text style={styles.qrHelp}>Scanner séquentiellement avec un autre terminal TacSuite pour importer.</Text>

                            <View style={styles.qrControls}>
                                <TouchableOpacity onPress={handlePrevQr} style={styles.qrNavBtn}>
                                    <MaterialIcons name="chevron-left" size={40} color="white" />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={handleNextQr} style={styles.qrNavBtn}>
                                    <MaterialIcons name="chevron-right" size={40} color="white" />
                                </TouchableOpacity>
                            </View>

                            <TouchableOpacity onPress={() => setShowQrExport(false)} style={styles.closeQrBtn}>
                                <Text style={styles.closeQrBtnText}>FERMER</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </Modal>
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
    deleteBtn: { padding: 5, justifyContent: 'center', marginLeft: 10 },

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
    submitBtn: { backgroundColor: '#3b82f6', width: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 8 },

    // QR EXPORT STYLES
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
    qrModalContent: { width: '85%', alignItems: 'center', backgroundColor: '#18181b', padding: 20, borderRadius: 20, borderWidth: 1, borderColor: '#333' },
    modalTitle: { color: 'white', fontSize: 20, fontWeight: '900', marginBottom: 10 },
    qrCounter: { color: '#3b82f6', fontWeight: 'bold', marginBottom: 20, fontSize: 16 },
    qrContainer: { padding: 10, backgroundColor: 'white', borderRadius: 10 },
    qrHelp: { color: '#71717a', textAlign: 'center', marginTop: 20, fontSize: 12 },
    qrControls: { flexDirection: 'row', justifyContent: 'space-between', width: '80%', marginTop: 20 },
    qrNavBtn: { backgroundColor: '#27272a', borderRadius: 30, padding: 5 },
    closeQrBtn: { marginTop: 30, paddingVertical: 12, paddingHorizontal: 30, backgroundColor: '#ef4444', borderRadius: 10 },
    closeQrBtnText: { color: 'white', fontWeight: 'bold' }
});

export default MainCouranteView;
