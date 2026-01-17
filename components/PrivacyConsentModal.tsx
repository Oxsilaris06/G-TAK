import React, { useState, useEffect } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';

// Clé de stockage mise à jour pour Praxis (Version 2 pour forcer le ré-affichage si mise à jour)
const CONSENT_KEY = 'Praxis_Privacy_Consent_v2';

interface PrivacyConsentModalProps {
  onConsentGiven: () => void; // Fonction appelée quand l'utilisateur accepte
}

export default function PrivacyConsentModal({ onConsentGiven }: PrivacyConsentModalProps) {
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    checkConsent();
  }, []);

  const checkConsent = async () => {
    try {
      const hasConsented = await AsyncStorage.getItem(CONSENT_KEY);
      if (hasConsented !== 'true') {
        setModalVisible(true);
      } else {
        onConsentGiven();
      }
    } catch (error) {
      console.error('Erreur lecture consentement:', error);
      setModalVisible(true); // Par sécurité, on redemande en cas d'erreur
    }
  };

  const handleAccept = async () => {
    try {
      await AsyncStorage.setItem(CONSENT_KEY, 'true');
      setModalVisible(false);
      onConsentGiven();
    } catch (error) {
      console.error('Erreur sauvegarde consentement:', error);
      onConsentGiven();
    }
  };

  const openPrivacyPolicy = () => {
    // Lien vers le fichier hébergé sur GitHub (à adapter si nécessaire)
    Linking.openURL('https://github.com/oxsilaris06/g-tak/blob/main/PRIVACY.md');
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={modalVisible}
      onRequestClose={() => {
        // Empêche la fermeture via le bouton retour Android sans accepter
        return; 
      }}
    >
      <View style={styles.centeredView}>
        <View style={styles.modalView}>
          <View style={styles.header}>
            <MaterialIcons name="security" size={28} color="#3b82f6" />
            <Text style={styles.modalTitle}>PROTOCOLE DE CONFIDENTIALITÉ</Text>
          </View>
          
          <ScrollView style={styles.scrollView} indicatorStyle="white">
            <Text style={styles.modalText}>
              Bienvenue dans <Text style={{fontWeight: 'bold', color: '#3b82f6'}}>Praxis</Text>. Cette application de suivi tactique fonctionne en réseau maillé (Peer-to-Peer) sans serveur central.
            </Text>

            <View style={styles.bulletPoint}>
              <View style={styles.bulletHeader}>
                <MaterialIcons name="location-on" size={20} color="#ef4444" />
                <Text style={styles.bulletTitle}>GÉOLOCALISATION (GPS)</Text>
              </View>
              <Text style={styles.bulletText}>
                Indispensable pour afficher votre position sur la carte et la partager <Text style={{fontWeight: 'bold', color: '#d4d4d8'}}>uniquement</Text> avec les membres connectés à votre session. Aucune position n'est stockée sur un serveur tiers.
              </Text>
            </View>

            <View style={styles.bulletPoint}>
              <View style={styles.bulletHeader}>
                <MaterialIcons name="qr-code-scanner" size={20} color="#eab308" />
                <Text style={styles.bulletTitle}>CAMÉRA</Text>
              </View>
              <Text style={styles.bulletText}>
                Accès requis uniquement pour scanner les QR Codes de session afin de rejoindre rapidement un groupe. Aucune image n'est enregistrée.
              </Text>
            </View>

            <View style={styles.bulletPoint}>
              <View style={styles.bulletHeader}>
                <MaterialIcons name="notifications-active" size={20} color="#22c55e" />
                <Text style={styles.bulletTitle}>NOTIFICATIONS</Text>
              </View>
              <Text style={styles.bulletText}>
                Pour vous alerter (Pings Hostiles, Messages Flash) même lorsque l'application est en arrière-plan ou l'écran éteint.
              </Text>
            </View>

            <View style={styles.infoBox}>
               <Text style={styles.infoText}>
                 <Text style={{fontWeight: 'bold'}}>Architecture Éphémère :</Text> Dès que vous quittez l'application ou la session, toutes les données tactiques (positions, historique, messages) sont effacées de la mémoire de l'appareil.
               </Text>
            </View>

            <Text style={styles.legalText}>
              En continuant, vous acceptez le partage de votre position en temps réel avec votre groupe et notre politique de confidentialité "Zéro Log".
            </Text>
            
            <TouchableOpacity onPress={openPrivacyPolicy} style={styles.linkContainer}>
              <Text style={styles.linkText}>LIRE LA POLITIQUE COMPLÈTE (GitHub)</Text>
              <MaterialIcons name="open-in-new" size={14} color="#3b82f6" />
            </TouchableOpacity>
          </ScrollView>

          <TouchableOpacity
            style={styles.button}
            onPress={handleAccept}
          >
            <Text style={styles.buttonText}>ACCEPTER ET INITIALISER</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.9)', // Fond très sombre
  },
  modalView: {
    width: '90%',
    maxHeight: '85%',
    backgroundColor: '#09090b', // Noir zinc
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#27272a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#27272a',
    paddingBottom: 15
  },
  scrollView: {
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: 'white',
    letterSpacing: 1,
  },
  modalText: {
    fontSize: 14,
    color: '#d4d4d8',
    marginBottom: 20,
    lineHeight: 20,
  },
  bulletPoint: {
    marginBottom: 16,
    backgroundColor: '#18181b',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)'
  },
  bulletHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8
  },
  bulletTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: 'white',
  },
  bulletText: {
    fontSize: 13,
    color: '#a1a1aa',
    lineHeight: 18,
  },
  infoBox: {
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      borderColor: 'rgba(59, 130, 246, 0.3)',
      borderWidth: 1,
      padding: 12,
      borderRadius: 8,
      marginBottom: 20
  },
  infoText: {
      color: '#60a5fa',
      fontSize: 12,
      fontStyle: 'italic'
  },
  legalText: {
    fontSize: 12,
    color: '#71717a',
    marginBottom: 15,
    fontStyle: 'italic',
    textAlign: 'center'
  },
  linkContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 5,
    padding: 10
  },
  linkText: {
    color: '#3b82f6',
    fontWeight: 'bold',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  button: {
    backgroundColor: '#3b82f6', // Bleu tactique
    borderRadius: 8,
    padding: 16,
    elevation: 2,
    width: '100%',
    alignItems: 'center'
  },
  buttonText: {
    color: 'white',
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 1
  },
});
