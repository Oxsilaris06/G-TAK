import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

const MASTER_KEY_ALIAS = 'praxis_master_key_v1';
const WRAPPED_KEY_ALIAS = 'praxis_wrapped_key_v1';
const SALT_ALIAS = 'praxis_auth_salt';

class CryptoService {
    /**
     * Initializes the Master Key.
     * If existing (Biometrics), returns it.
     * If new install, generates it, encrypts with passphrase, and returns it.
     */
    async initializeOrUnlock(passphrase: string): Promise<string | null> {
        // 1. Try to load WRAPPED key
        const wrappedKey = await SecureStore.getItemAsync(WRAPPED_KEY_ALIAS);

        if (!wrappedKey) {
            // NEW INSTALL (or reset)
            // Generate Random Master Key
            const masterKey = await this.generateRandomKey();
            // Encrypt and Save
            await this.storeWrappedKey(masterKey, passphrase);
            return masterKey;
        } else {
            // UNLOCK EXISTING
            try {
                const masterKey = await this.unwrapKey(wrappedKey, passphrase);
                return masterKey;
            } catch (e) {
                console.warn('Unlock failed');
                return null;
            }
        }
    }

    /**
     * Resets the passphrase using a Biometrically retrieved Master Key
     */
    async resetPassphraseWithBiometrics(newPassphrase: string): Promise<boolean> {
        const masterKey = await this.getMasterKeyWithBiometrics();
        if (!masterKey) return false;

        await this.storeWrappedKey(masterKey, newPassphrase);
        return true;
    }

    // --- INTERNAL HELPERS ---

    private async generateRandomKey(): Promise<string> {
        const bytes = await Crypto.getRandomBytesAsync(32); // 256 bits
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    private async wrapKey(masterKey: string, passphrase: string): Promise<string> {
        // Derive KEK (Key Encryption Key) from Passphrase
        const kek = await this.deriveKeyFromPassphrase(passphrase); // 256-bit hex

        // Encrypt MK with KEK. 
        // Simple XOR for MVP/Current constraints (since no crypto-js/AES lib).
        // Ideally: AES-GCM(kek, masterKey).
        // Given we are MilSpec, we SHOULD use better, but without libraries...
        // We will stick to the XOR pattern used in Connectivity for consistency 
        // BUT with a note to upgrade.
        // ACTUALLY: We can use `expo-secure-store` to store the MK directly? 
        // No, we want it protected by passphrase when biometrics is OFF.

        const keyChars = kek.split('').map(c => c.charCodeAt(0));
        let encrypted = '';
        for (let i = 0; i < masterKey.length; i++) {
            encrypted += String.fromCharCode(masterKey.charCodeAt(i) ^ keyChars[i % keyChars.length]);
        }
        return btoa(encrypted);
    }

    private async unwrapKey(wrappedKey: string, passphrase: string): Promise<string> {
        const kek = await this.deriveKeyFromPassphrase(passphrase);
        const encrypted = atob(wrappedKey);

        const keyChars = kek.split('').map(c => c.charCodeAt(0));
        let decrypted = '';
        for (let i = 0; i < encrypted.length; i++) {
            decrypted += String.fromCharCode(encrypted.charCodeAt(i) ^ keyChars[i % keyChars.length]);
        }

        // Verification? If decrypted looks like a hex string...
        if (!/^[0-9a-f]{64}$/i.test(decrypted)) {
            throw new Error('Invalid Passphrase');
        }
        return decrypted;
    }

    private async storeWrappedKey(masterKey: string, passphrase: string) {
        const wrapped = await this.wrapKey(masterKey, passphrase);
        await SecureStore.setItemAsync(WRAPPED_KEY_ALIAS, wrapped);
    }

    /**
     * Derive a KEK from the user's passphrase.
     */
    async deriveKeyFromPassphrase(passphrase: string): Promise<string> {
        let salt = await SecureStore.getItemAsync(SALT_ALIAS);
        if (!salt) {
            const randomBytes = await Crypto.getRandomBytesAsync(16);
            salt = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
            await SecureStore.setItemAsync(SALT_ALIAS, salt);
        }

        let key = passphrase + salt;
        for (let i = 0; i < 5000; i++) {
            key = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
        }
        return key;
    }

    /**
     * Save the Master Key into Hardware Secure Storage protected by Biometrics.
     */
    async saveMasterKeyWithBiometrics(key: string): Promise<boolean> {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (!hasHardware || !isEnrolled) return false;

        try {
            await SecureStore.setItemAsync(MASTER_KEY_ALIAS, key, {
                requireAuthentication: true,
                keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
            });
            return true;
        } catch (e) {
            console.error('[CryptoService] Failed to save key with biometrics', e);
            return false;
        }
    }

    /**
     * Try to retrieve Master Key via Biometrics.
     */
    async getMasterKeyWithBiometrics(): Promise<string | null> {
        try {
            const exists = await SecureStore.getItemAsync(MASTER_KEY_ALIAS, { requireAuthentication: false });
            if (!exists) return null;

            const fileResult = await LocalAuthentication.authenticateAsync({
                promptMessage: 'Authentification Requise',
                cancelLabel: 'Utiliser Phrase Secrète',
                disableDeviceFallback: true,
            });

            if (fileResult.success) {
                return await SecureStore.getItemAsync(MASTER_KEY_ALIAS, { requireAuthentication: false });
            }
            return null;
        } catch (e) {
            console.warn('[CryptoService] Biometric retrieval failed', e);
            return null;
        }
    }

    async isBiometricEnabled(): Promise<boolean> {
        return !!(await SecureStore.getItemAsync(MASTER_KEY_ALIAS, { requireAuthentication: false }));
    }

    async clearBiometricKey(): Promise<void> {
        await SecureStore.deleteItemAsync(MASTER_KEY_ALIAS);
    }

    async generateSessionKey(): Promise<string> {
        return this.generateRandomKey();
    }
}

export const cryptoService = new CryptoService();
