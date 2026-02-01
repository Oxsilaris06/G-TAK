// ID PROJET VALIDE
const PROJECT_ID = "f55fd8e2-57c6-4432-a64c-fae41bb16a3e";
const VERSION = "4.1.0";

export default {
  expo: {
    name: "Praxis",
    slug: "praxis",
    version: VERSION,
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    
    runtimeVersion: VERSION,
    
    // Inclusion des assets
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
      fallbackToCacheTimeout: 30000
    },

    extra: {
      eas: {
        projectId: PROJECT_ID
      }
    },

    // --- AJOUT CORRECTIF POUR IOS ---
    ios: {
      bundleIdentifier: "com.praxis.app",
      supportsTablet: true,
      infoPlist: {
        UIBackgroundModes: ["location", "fetch"],
        NSLocationWhenInUseUsageDescription: "Cette application a besoin de votre position pour le suivi tactique.",
        NSLocationAlwaysAndWhenInUseUsageDescription: "Cette application a besoin de votre position même en arrière-plan pour le suivi tactique continu."
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
      // --- SECTION CRITIQUE : FORÇAGE DES HEADERS ---
      // On inscrit ces valeurs directement dans le coeur d'Android
      metaData: {
        "expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH": "ALWAYS",
        "expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS": "30000",
        // Force l'URL (évite les erreurs de construction)
        "expo.modules.updates.EXPO_UPDATES_URL": `https://u.expo.dev/${PROJECT_ID}`,
        // Force le canal
        "expo.modules.updates.EXPO_UPDATES_CHANNEL_NAME": "production",
        // Force la version (Règle l'erreur "runtime-version: Required")
        "expo.modules.updates.EXPO_RUNTIME_VERSION": VERSION
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
