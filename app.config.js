export default {
  expo: {
    name: "Praxis",
    slug: "praxis",
    version: "4.0.0",
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    // Configuration EAS Update
    runtimeVersion: {
      policy: "appVersion"
    },
    updates: {
      url: "https://u.expo.dev/f55fd8e2-57c6-4432-a64c-fae41bb16a3e"
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
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "INTERNET",
        "WAKE_LOCK",
        "CAMERA" // Réactivé pour le QR Scan
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
            // AUGMENTATION DE LA MÉMOIRE JVM POUR GRADLE (FIX HEAP SPACE)
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
          "microphonePermission": false, // On garde le micro désactivé pour la Data
          "recordAudioAndroid": false
        }
      ],
      [
        "@config-plugins/react-native-webrtc",
        {
          // On laisse WebRTC sans caméra/micro, c'est expo-camera qui gère le scan
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
