import * as FileSystem from 'expo-file-system';

const IMAGE_DIR = `${FileSystem.documentDirectory}images/`;

// Ensure directory exists
const ensureDirExists = async () => {
    const dir = await FileSystem.getInfoAsync(IMAGE_DIR);
    if (!dir.exists) {
        await FileSystem.makeDirectoryAsync(IMAGE_DIR, { intermediates: true });
    }
};

export const imageService = {
    /**
     * Save a temporary image to permanent local storage
     * @param tempUri URI of the image (picker or camera)
     * @returns object with { uri: localUri, id: uniqueId }
     */
    saveImage: async (tempUri: string): Promise<{ uri: string; id: string }> => {
        await ensureDirExists();
        const id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const extension = tempUri.split('.').pop() || 'jpg';
        const fileName = `${id}.${extension}`;
        const destUri = `${IMAGE_DIR}${fileName}`;

        await FileSystem.copyAsync({
            from: tempUri,
            to: destUri
        });

        return { uri: destUri, id: fileName }; // ID includes extension for simplicity
    },

    /**
     * Get the full local URI for an image ID
     */
    getImageUri: (id: string): string => {
        return `${IMAGE_DIR}${id}`;
    },

    /**
     * Delete an image from local storage
     */
    deleteImage: async (id: string): Promise<void> => {
        const uri = `${IMAGE_DIR}${id}`;
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists) {
            await FileSystem.deleteAsync(uri, { idempotent: true });
        }
    },

    /**
     * Check if image exists locally
     */
    exists: async (id: string): Promise<boolean> => {
        const uri = `${IMAGE_DIR}${id}`;
        const info = await FileSystem.getInfoAsync(uri);
        return info.exists;
    },

    /**
     * Get image as Base64 (only for chunking, not for display)
     */
    readAsBase64: async (id: string): Promise<string> => {
        const uri = `${IMAGE_DIR}${id}`;
        return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    },

    /**
     * Write Base64 chunk to file (append or create)
     * NOTE: Expo FileSystem writeAsStringAsync overwrites by default.
     * For streaming, it might be better to collect chunks or use append (if supported/simulated).
     * Expo FS doesn't support append easily for base64. 
     * Strategy: Write temp files for chunks or read-modify-write (slow).
     * Better Strategy for React Native P2P: 
     * The receiver re-assembles in memory or temp string if size permits (images < 5MB OK for modern phones), 
     * OR writes individual chunk files and combines them. 
     * 
     * Let's assume standard "write whole file at end" or "append" if possible.
     * Actually `FileSystem.writeAsStringAsync` does NOT support append.
     * But `StorageAccessFramework` does (Android).
     * 
     * Simplest approach for this "Architecture":
     * Receiver accumulates chunks in RAM (Buffer/String). 
     * When complete, writes to file.
     * images are typically < 2MB (compressed). Buffer in RAM is acceptable vs complexity.
     */
    writeBase64: async (id: string, base64: string): Promise<string> => {
        await ensureDirExists();
        const uri = `${IMAGE_DIR}${id}`;
        await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
        return uri;
    }
};
