export default {
  expo: {
    name: "Praxis",
    slug: "praxis",
    version: "4.0.0",
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    
    // 1. VERSION D'EXÉCUTION FIGÉE
    // L'APK et le serveur EAS Update doivent avoir cette valeur exacte.
    runtimeVersion: "4.0.0", 
    
    // 2. CONFIGURATION DES MISES À JOUR
    updates: {
      // URL vérifiée sans espace
      url: "https://u.expo.dev/f55fd8e2-57c6-4432-a64c-fae41bb16a3e",
      // On force le canal production
      requestHeaders: {
        "expo-channel-name": "production"
      },
      // Important pour le redémarrage automatique
      enabled: true,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0
    },

    extra: {
      eas: {
        projectId: "f55fd8e2-57c6-4432-a64c-fae41bb16a3e"
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
      // Permissions complètes
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
