import React from 'react';
import { 
  Modal, 
  View, 
  Text, 
  TouchableOpacity, 
  StyleSheet, 
  Dimensions,
  Platform
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { UserData, OperatorRole } from '../types';
import { STATUS_COLORS } from '../constants';

const { width } = Dimensions.get('window');

interface OperatorActionModalProps {
  visible: boolean;
  targetOperator: UserData | null;
  currentUserRole: OperatorRole;
  onClose: () => void;
  onPrivateCall: (id: string) => void;
  onKick: (id: string) => void;
  onNavigate: (id: string) => void; // Callback pour la navigation
}

const OperatorActionModal: React.FC<OperatorActionModalProps> = ({
  visible, targetOperator, currentUserRole, onClose, onPrivateCall, onKick, onNavigate
}) => {
  if (!targetOperator) return null;

  const status = targetOperator.status || 'CLEAR';
  const statusColor = STATUS_COLORS[status] || '#22c55e';
  const battery = targetOperator.bat ?? 0;

  // Calcul couleur batterie
  let batColor = '#22c55e';
  if (battery < 20) batColor = '#ef4444';
  else if (battery < 50) batColor = '#eab308';

  return (
    <Modal 
      visible={visible} 
      animationType="fade" 
      transparent={true}
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalContainer}>
            
            {/* EN-TÊTE OPÉRATEUR */}
            <View style={styles.header}>
                <View style={styles.headerIconContainer}>
                     <MaterialIcons name="account-circle" size={40} color="#3b82f6" />
                </View>
                <View style={{alignItems: 'center'}}>
                    <Text style={styles.headerLabel}>OPÉRATEUR CIBLE</Text>
                    <Text style={styles.callsign}>{targetOperator.callsign || 'INCONNU'}</Text>
                    <View style={styles.idBadge}>
                        <Text style={styles.idText}>ID: {targetOperator.id}</Text>
                    </View>
                </View>
            </View>

            {/* BARRE DE STATUT & BATTERIE */}
            <View style={styles.infoRow}>
                <View style={[styles.infoBox, { borderColor: statusColor }]}>
                    <MaterialIcons name="lens" size={14} color={statusColor} />
                    <View style={{marginLeft: 10}}>
                        <Text style={[styles.infoLabel, { color: statusColor }]}>STATUT</Text>
                        <Text style={styles.infoValue}>{status}</Text>
                    </View>
                </View>

                <View style={[styles.infoBox, { borderColor: batColor }]}>
                    <MaterialIcons name="battery-std" size={14} color={batColor} />
                    <View style={{marginLeft: 10}}>
                        <Text style={[styles.infoLabel, { color: batColor }]}>BATTERIE</Text>
                        <Text style={styles.infoValue}>{battery}%</Text>
                    </View>
                </View>
            </View>

            <View style={styles.divider} />

            {/* --- ACTIONS --- */}
            <View style={styles.actionsContainer}>
                
                {/* BOUTON 1: NAVIGATION (NOUVEAU) */}
                <TouchableOpacity 
                    onPress={() => { onNavigate(targetOperator.id); onClose(); }} 
                    style={[styles.actionBtn, {backgroundColor: 'rgba(6, 182, 212, 0.15)', borderColor: '#06b6d4'}]}
                >
                    <View style={[styles.btnIconBox, {backgroundColor: '#06b6d4'}]}>
                        <MaterialIcons name="directions-run" size={24} color="white" />
                    </View>
                    <View style={styles.btnTextBox}>
                        <Text style={[styles.btnTitle, {color: '#06b6d4'}]}>RALLIEMENT</Text>
                        <Text style={styles.btnSubtitle}>Guidage GPS Tactique vers la cible</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={24} color="#06b6d4" />
                </TouchableOpacity>

                {/* BOUTON 2: APPEL PRIVÉ */}
                <TouchableOpacity 
                    onPress={() => { onPrivateCall(targetOperator.id); onClose(); }} 
                    style={[styles.actionBtn, {backgroundColor: 'rgba(217, 70, 239, 0.15)', borderColor: '#d946ef'}]}
                >
                    <View style={[styles.btnIconBox, {backgroundColor: '#d946ef'}]}>
                        <MaterialIcons name="lock" size={24} color="white" />
                    </View>
                    <View style={styles.btnTextBox}>
                        <Text style={[styles.btnTitle, {color: '#d946ef'}]}>CANAL PRIVÉ</Text>
                        <Text style={styles.btnSubtitle}>Communication audio chiffrée P2P</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={24} color="#d946ef" />
                </TouchableOpacity>

                {/* BOUTON 3: KICK (HÔTE SEULEMENT) */}
                {currentUserRole === OperatorRole.HOST && (
                    <TouchableOpacity 
                        onPress={() => { onKick(targetOperator.id); onClose(); }} 
                        style={[styles.actionBtn, {backgroundColor: 'rgba(239, 68, 68, 0.15)', borderColor: '#ef4444', marginTop: 10}]}
                    >
                        <View style={[styles.btnIconBox, {backgroundColor: '#ef4444'}]}>
                            <MaterialIcons name="block" size={24} color="white" />
                        </View>
                        <View style={styles.btnTextBox}>
                            <Text style={[styles.btnTitle, {color: '#ef4444'}]}>BANNIR OPÉRATEUR</Text>
                            <Text style={styles.btnSubtitle}>Exclure définitivement de la mission</Text>
                        </View>
                    </TouchableOpacity>
                )}
            </View>

            {/* PIED DE PAGE : FERMER */}
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>FERMER LE MENU</Text>
            </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.9)', 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 20,
    backdropFilter: 'blur(10px)' // Pour iOS si supporté
  },
  modalContainer: { 
    width: '100%', 
    maxWidth: 380, 
    backgroundColor: '#18181b', 
    borderRadius: 24, 
    padding: 24, 
    borderWidth: 1, 
    borderColor: 'rgba(255,255,255,0.1)', 
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 20 
  },
  header: { 
    alignItems: 'center', 
    marginBottom: 25 
  },
  headerIconContainer: {
      marginBottom: 10,
      shadowColor: '#3b82f6',
      shadowOffset: {width: 0, height: 0},
      shadowOpacity: 0.5,
      shadowRadius: 10
  },
  headerLabel: {
    color: '#71717a',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginBottom: 5
  },
  callsign: { 
    color: 'white', 
    fontSize: 32, 
    fontWeight: '900', 
    letterSpacing: 1, 
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: {width: 0, height: 2},
    textShadowRadius: 4
  },
  idBadge: {
      backgroundColor: '#27272a',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      marginTop: 8,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.1)'
  },
  idText: { 
    color: '#a1a1aa', 
    fontSize: 12, 
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: 'bold'
  },
  infoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 25
  },
  infoBox: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#09090b',
      padding: 12,
      borderRadius: 12,
      borderWidth: 1,
  },
  infoLabel: {
      fontSize: 9,
      fontWeight: 'bold',
      letterSpacing: 0.5
  },
  infoValue: {
      color: 'white',
      fontSize: 14,
      fontWeight: 'bold',
      marginTop: 2
  },
  divider: { 
    height: 1, 
    backgroundColor: '#27272a', 
    marginBottom: 25 
  },
  actionsContainer: {
      gap: 12
  },
  actionBtn: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 16, 
    borderRadius: 16, 
    width: '100%',
    borderWidth: 1
  },
  btnIconBox: { 
    width: 40, 
    height: 40, 
    borderRadius: 12, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3
  },
  btnTextBox: { 
    flex: 1 
  },
  btnTitle: { 
    fontWeight: 'bold', 
    fontSize: 16,
    letterSpacing: 0.5
  },
  btnSubtitle: { 
    color: 'rgba(255,255,255,0.6)', 
    fontSize: 11, 
    marginTop: 2 
  },
  closeButton: { 
    marginTop: 30, 
    padding: 15, 
    alignItems: 'center',
    backgroundColor: '#27272a',
    borderRadius: 12
  },
  closeButtonText: { 
    color: '#71717a', 
    fontSize: 12, 
    fontWeight: 'bold', 
    letterSpacing: 1 
  }
});

export default OperatorActionModal;
