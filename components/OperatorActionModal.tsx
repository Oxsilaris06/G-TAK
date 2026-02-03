import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Alert } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { UserData, OperatorRole } from '../types';

interface Props {
  visible: boolean;
  targetOperator: UserData | null;
  currentUserRole: OperatorRole;
  onClose: () => void;
  onKick: (id: string, banType: 'temp' | 'perm') => void;
  onNavigate: (id: string) => void;
}

const OperatorActionModal: React.FC<Props> = ({
  visible,
  targetOperator,
  currentUserRole,
  onClose,
  onKick,
  onNavigate,
}) => {
  if (!targetOperator) return null;

  const handleKickPress = () => {
    Alert.alert(
      'Exclusion',
      `Voulez-vous exclure ${targetOperator.callsign} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Exclure (Temporaire)', onPress: () => onKick(targetOperator.id, 'temp') },
        { text: 'Bannir (Définitif)', onPress: () => onKick(targetOperator.id, 'perm'), style: 'destructive' },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <MaterialIcons name="person" size={24} color="#3b82f6" />
            <Text style={styles.title}>{targetOperator.callsign}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <MaterialIcons name="close" size={24} color="#a1a1aa" />
            </TouchableOpacity>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>ID:</Text>
            <Text style={styles.infoValue}>{targetOperator.id}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Statut:</Text>
            <Text style={[styles.infoValue, { color: targetOperator.status === 'CONTACT' ? '#ef4444' : '#22c55e' }]}>
              {targetOperator.status}
            </Text>
          </View>

          <View style={styles.actionsGrid}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => {
                onNavigate(targetOperator.id);
                onClose();
              }}
            >
              <View style={[styles.iconContainer, { backgroundColor: 'rgba(6, 182, 212, 0.2)' }]}>
                <MaterialIcons name="navigation" size={32} color="#06b6d4" />
              </View>
              <Text style={styles.btnLabel}>RALLIEMENT</Text>
            </TouchableOpacity>

            {currentUserRole === OperatorRole.HOST && (
              <TouchableOpacity style={styles.actionBtn} onPress={handleKickPress}>
                <View style={[styles.iconContainer, { backgroundColor: 'rgba(239, 68, 68, 0.2)' }]}>
                  <MaterialIcons name="person-remove" size={32} color="#ef4444" />
                </View>
                <Text style={[styles.btnLabel, { color: '#ef4444' }]}>EXCLURE</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  content: {
    backgroundColor: '#18181b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 'bold', color: 'white', marginLeft: 10, flex: 1 },
  closeBtn: { padding: 5 },
  infoRow: { flexDirection: 'row', marginBottom: 10 },
  infoLabel: { color: '#71717a', width: 60, fontWeight: 'bold' },
  infoValue: { color: '#d4d4d8', fontWeight: '500' },
  actionsGrid: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 30, marginBottom: 20 },
  actionBtn: { alignItems: 'center', width: 100 },
  iconContainer: { width: 64, height: 64, borderRadius: 32, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  btnLabel: { color: '#d4d4d8', fontSize: 12, fontWeight: 'bold' },
});

export default OperatorActionModal;
