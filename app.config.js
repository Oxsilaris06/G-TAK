import 'dotenv/config';

// --- CONSTANTES GLOBALES ---
// ID du projet G-TAK (Assurez-vous que c'est le bon ID EAS pour G-TAK)
const PROJECT_ID = "41321365-3a31-43e4-9706-a5e5739e0400";
// Version unique pour synchroniser le binaire et le JS
const VERSION = "4.1.0"; 

export default {
  expo: {
    name: "G-TAK",
    slug: "g-tak",
    version: VERSION,
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    
    // 1. VERSION DU RUNTIME
    // Fixée pour garantir la compatibilité entre le code JS et le code natif
    runtimeVersion: VERSION,

    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#1a1a1a"
    },
    assetBundlePatterns: [
      "**/*"
    ],

    // 2. CONFIGURATION CENTRALE DES MISES À JOUR (EAS UPDATE)
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
    owner: "oxsilaris06",

    // 3. CONFIGURATION IOS (Avec correctif "Forçage")
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.oxsilaris.gtak",
      config: {
        usesNonExemptEncryption: false
      },
      infoPlist: {
        NSLocationWhenInUseUsageDescription: "G-TAK a besoin de votre position pour afficher votre emplacement sur la carte tactique et le partager avec votre équipe.",
        NSLocationAlwaysAndWhenInUseUsageDescription: "G-TAK a besoin de votre position en arrière-plan pour le suivi des opérations tactiques.",
        UIBackgroundModes: [
          "location",
          "fetch"
        ],
        // --- FORÇAGE DES UPDATES DANS INFO.PLIST ---
        // Ces valeurs sont gravées dans le binaire iOS
        EXUpdatesURL: `https://u.expo.dev/${PROJECT_ID}`,
        EXUpdatesChannelName: "production",
        EXUpdatesRuntimeVersion: VERSION,
        EXUpdatesCheckOnLaunch: "ALWAYS",
        EXUpdatesLaunchWaitMs: 30000
      }
    },

    // 4. CONFIGURATION ANDROID (Avec correctif "Forçage")
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#1a1a1a"
      },
      package: "com.oxsilaris.gtak",
      permissions: [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "FOREGROUND_SERVICE",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE_LOCATION", // Nécessaire pour Android 14+
        "INTERNET",
        "WAKE_LOCK"
      ],
      // --- FORÇAGE DES UPDATES DANS ANDROIDMANIFEST ---
      // Ces valeurs sont gravées dans le binaire Android
      metaData: {
        "expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH": "ALWAYS",
        "expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS": "30000",
        "expo.modules.updates.EXPO_UPDATES_URL": `https://u.expo.dev/${PROJECT_ID}`,
        "expo.modules.updates.EXPO_UPDATES_CHANNEL_NAME": "production",
        "expo.modules.updates.EXPO_RUNTIME_VERSION": VERSION
      }
    },

    web: {
      favicon: "./assets/icon.png"
    },
    
    // 5. PLUGINS (Incluant les propriétés de build critiques)
    plugins: [
      "expo-font",
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission: "Allow $(PRODUCT_NAME) to use your location."
        }
      ],
      // Plugin critique pour la stabilité du build Android/iOS
      [
        "expo-build-properties",
        {
          android: {
            kotlinVersion: "1.9.23",
            compileSdkVersion: 34,
            targetSdkVersion: 34,
            buildToolsVersion: "34.0.0",
            // Augmentation de la mémoire pour éviter les crashs de build Gradle
            gradleProperties: [
              { key: 'org.gradle.jvmargs', value: '-Xmx4608m -XX:MaxMetaspaceSize=512m' }
            ]
          },
          ios: {
            deploymentTarget: "13.4"
          }
        }
      ]
    ]
  }
};
