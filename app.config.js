export default {
  expo: {
    name: "ComTac SA",
    slug: "comtac-sa",
    version: "3.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#000000"
    },
    assetBundlePatterns: [
      "**/*"
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.comtac.sa",
      infoPlist: {
        UIBackgroundModes: ["location", "fetch"],
        NSLocationAlwaysAndWhenInUseUsageDescription: "ComTac nécessite votre position pour la coordination tactique avec votre équipe.",
        NSLocationAlwaysUsageDescription: "Le suivi en arrière-plan est nécessaire pour la sécurité de l'équipe même écran éteint.",
        NSLocationWhenInUseUsageDescription: "Affichage de votre position sur la carte tactique.",
        NSCameraUsageDescription: "Nécessaire pour scanner les QR Codes de connexion."
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#000000"
      },
      package: "com.comtac.sa",
      // Permissions strictes pour SA (Situational Awareness) - Pas de RECORD_AUDIO
      permissions: [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "CAMERA",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "WAKE_LOCK",
        "VIBRATE",
        "INTERNET",
        "ACCESS_NETWORK_STATE",
        "ACCESS_WIFI_STATE"
      ]
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    plugins: [
      [
        "expo-location",
        {
          "locationAlwaysAndWhenInUsePermission": "Allow ComTac to use your location for team awareness."
        }
      ],
      [
        "expo-camera",
        {
          "cameraPermission": "Allow ComTac to access your camera for QR scanning."
        }
      ],
      // Ce plugin remplace la modification manuelle de build.gradle
      [
        "expo-build-properties",
        {
          "android": {
            "compileSdkVersion": 34,
            "targetSdkVersion": 34,
            "buildToolsVersion": "34.0.0"
          }
        }
      ]
    ],
    extra: {
      eas: {
        projectId: "your-project-id"
      }
    }
  }
};
