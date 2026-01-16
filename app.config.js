export default {
  expo: {
    name: "TacSuite",
    slug: "tacsuite",
    version: "3.3.0",
    orientation: "default",
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
      bundleIdentifier: "com.tacsuite.app",
      infoPlist: {
        UIBackgroundModes: ["location", "fetch", "voip"],
        NSLocationAlwaysAndWhenInUseUsageDescription: "Suivi tactique de l'équipe même en arrière-plan.",
        NSLocationWhenInUseUsageDescription: "Affichage position sur carte.",
        NSCameraUsageDescription: "Scan QR Code.",
        // AJOUT CRITIQUE POUR LE RÉSEAU LOCAL (Même WiFi)
        NSLocalNetworkUsageDescription: "Nécessaire pour la connexion P2P entre appareils sur le même réseau WiFi."
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#000000"
      },
      package: "com.tacsuite.app",
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
        "ACCESS_WIFI_STATE",
        "CHANGE_WIFI_STATE", // Utile pour certaines implémentations WebRTC
        "POST_NOTIFICATIONS"
      ]
    },
    plugins: [
      [
        "expo-location",
        {
          "locationAlwaysAndWhenInUsePermission": "Allow TacSuite to use your location for team awareness."
        }
      ],
      [
        "expo-camera",
        {
          "cameraPermission": "Allow TacSuite to access your camera for QR scanning."
        }
      ],
      "expo-notifications"
    ],
    extra: {
      eas: {
        projectId: "your-project-id"
      }
    }
  }
};
