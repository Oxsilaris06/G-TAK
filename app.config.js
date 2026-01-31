// ID TROUVÉ DANS LES LOGS DE DIAGNOSTIC EAS (Le bon !)
const PROJECT_ID = "019c0ef6-2134-7c8f-8aba-72da5bafadc6"; 
const VERSION = "4.1.0";

export default {
  expo: {
    name: "Praxis",
    slug: "praxis",
    version: VERSION,
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    
    // Runtime version alignée
    runtimeVersion: VERSION,
    
    // --- CORRECTION CRITIQUE ICI ---
    // On force l'inclusion de TOUS les fichiers du dossier assets dans la mise à jour
    assetBundlePatterns: [
      "**/*"
    ],
    
    updates: {
      url: `https://u.expo.dev/${PROJECT_ID}`,
      requestHeaders: {
        "expo-channel-name": "production"
      },
      enabled: true,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 30000 // On augmente le timeout à 30s pour les connexions lentes
    },

    extra: {
      eas: {
        projectId: PROJECT_ID
      }
    },

    splash: {
      image: "./assets/icon2.png",
      resizeMode: "contain",
      backgroundColor: "#000000"
    },
    android: {
      package: "com.praxis.app",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#000000"
      },
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "INTERNET",
        "WAKE_LOCK",
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE"
      ]
    },
    plugins: [
      [
        "expo-build-properties",
        {
          android: {
            kotlinVersion: "1.9.23",
            compileSdkVersion: 34,
            targetSdkVersion: 34,
            buildToolsVersion: "34.0.0",
            newArchEnabled: false,
            gradleProperties: [
              { key: 'org.gradle.jvmargs', value: '-Xmx4608m -XX:MaxMetaspaceSize=512m' }
            ]
          }
        }
      ],
      [
        "expo-camera",
        {
          "cameraPermission": "Nécessaire pour scanner les QR Codes de session.",
          "microphonePermission": false,
          "recordAudioAndroid": false
        }
      ],
      [
        "@config-plugins/react-native-webrtc",
        {
          cameraPermission: false, 
          microphonePermission: false
        }
      ],
      "expo-location",
      "expo-notifications",
      "expo-task-manager"
    ]
  }
};
