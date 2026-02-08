import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { cryptoService } from '../services/cryptoService';

interface Props {
    onUnlock: (key: string) => void;
}

const SecureBootView: React.FC<Props> = ({ onUnlock }) => {
    const [passphrase, setPassphrase] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [status, setStatus] = useState<'idle' | 'biometric' | 'deriving'>('idle');
    const [hasBiometrics, setHasBiometrics] = useState(false);
    const [isResetMode, setIsResetMode] = useState(false); // New state for Reset Mode

    useEffect(() => {
        checkBiometrics();
    }, []);

    const checkBiometrics = async () => {
        const enabled = await cryptoService.isBiometricEnabled();
        setHasBiometrics(enabled);

        if (enabled && !isResetMode) {
            attemptBiometricUnlock();
        }
    };

    const attemptBiometricUnlock = async () => {
        setStatus('biometric');
        const key = await cryptoService.getMasterKeyWithBiometrics();
        if (key) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            onUnlock(key); // Success!
        } else {
            setStatus('idle');
            // Silent fail or small vibe
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
    };

    const handleUnlock = async () => {
        if (passphrase.length < 4) {
            Alert.alert('Erreur', 'La phrase secrète est trop courte.');
            return;
        }

        setIsProcessing(true);
        setStatus('deriving');

        // Give UI time to update
        setTimeout(async () => {
            try {
                if (isResetMode) {
                    // RESET MODE: We are setting a NEW passphrase using Biometric Auth
                    const success = await cryptoService.resetPassphraseWithBiometrics(passphrase);
                    if (success) {
                        Alert.alert("Succès", "Phrase secrète mise à jour !");
                        // Login immediately
                        const key = await cryptoService.getMasterKeyWithBiometrics();
                        if (key) onUnlock(key);
                    } else {
                        Alert.alert("Erreur", "Echec de la réinitialisation biométrique.");
                    }
                } else {
                    // NORMAL UNLOCK or NEW INSTALL
                    const key = await cryptoService.initializeOrUnlock(passphrase);

                    if (key) {
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        onUnlock(key);
                    } else {
                        Alert.alert('Echec', 'Phrase secrète incorrecte.');
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                    }
                }
            } catch (e) {
                Alert.alert('Erreur', 'Une erreur est survenue.');
            } finally {
                setIsProcessing(false);
                setStatus('idle');
            }
        }, 100);
    };

    const startResetFlow = async () => {
        // Verify biometrics FIRST before allowing reset mode
        const key = await cryptoService.getMasterKeyWithBiometrics();
        if (key) {
            setIsResetMode(true);
            setPassphrase('');
            Alert.alert("Mode Réinitialisation", "Authentification biométrique réussie.\nEntrez votre NOUVELLE phrase secrète.");
        } else {
            Alert.alert("Accès Refusé", "Impossible de réinitialiser sans authentification biométrique.");
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <View style={styles.content}>
                <MaterialIcons name={isResetMode ? "lock-reset" : "lock"} size={64} color="#ef4444" style={styles.icon} />
                <Text style={styles.title}>{isResetMode ? "RÉINITIALISATION" : "SECURE BOOT"}</Text>
                <Text style={styles.subtitle}>
                    {isResetMode ? "Définissez une nouvelle phrase" : "Chiffrement Militaire Actif"}
                </Text>

                <View style={styles.inputContainer}>
                    <TextInput
                        style={styles.input}
                        placeholder={isResetMode ? "Nouvelle Phrase Secrète" : "Phrase Secrète"}
                        placeholderTextColor="#666"
                        secureTextEntry
                        value={passphrase}
                        onChangeText={setPassphrase}
                        autoCapitalize="none"
                    />
                </View>

                <TouchableOpacity
                    style={[styles.btn, isProcessing && styles.btnDisabled]}
                    onPress={handleUnlock}
                    disabled={isProcessing}
                >
                    {status === 'deriving' ? (
                        <ActivityIndicator color="white" />
                    ) : (
                        <Text style={styles.btnText}>
                            {isResetMode ? "ENREGISTRER" : "DÉVERROUILLER"}
                        </Text>
                    )}
                </TouchableOpacity>

                {!isResetMode && hasBiometrics && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
                        <TouchableOpacity style={styles.bioBtn} onPress={attemptBiometricUnlock}>
                            <MaterialIcons name="fingerprint" size={24} color="#ef4444" />
                            <Text style={styles.bioText}>Biométrie</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.bioBtn} onPress={startResetFlow}>
                            <Text style={[styles.bioText, { color: '#888' }]}>Oublié ?</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {isResetMode && (
                    <TouchableOpacity style={{ marginTop: 10 }} onPress={() => setIsResetMode(false)}>
                        <Text style={{ color: '#888' }}>Annuler</Text>
                    </TouchableOpacity>
                )}
            </View>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#111',
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        width: '80%',
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#1a1a1a',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#333',
        elevation: 5,
    },
    icon: {
        marginBottom: 20,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#ef4444',
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
        marginBottom: 5,
    },
    subtitle: {
        fontSize: 12,
        color: '#888',
        marginBottom: 30,
        fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    },
    inputContainer: {
        width: '100%',
        marginBottom: 20,
    },
    input: {
        backgroundColor: '#222',
        color: 'white',
        padding: 15,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#444',
        textAlign: 'center',
        fontSize: 18,
    },
    btn: {
        backgroundColor: '#ef4444',
        paddingVertical: 12,
        paddingHorizontal: 30,
        borderRadius: 8,
        width: '100%',
        alignItems: 'center',
        marginBottom: 15,
    },
    btnDisabled: {
        opacity: 0.7,
    },
    btnText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    },
    bioBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        padding: 10,
    },
    bioText: {
        color: '#ef4444',
        fontSize: 14,
    }
});

export default SecureBootView;
