export default {
  expo: {
    name: "Praxis",
    slug: "praxis",
    version: "3.3.0",
    orientation: "default",
    icon: "./assets/icon.png", // Maintenu sur icon.png pour la miniature/app icon
    userInterfaceStyle: "dark",
    splash: {
      image: "./assets/icon2.png", // Changé pour icon2.png (Splash Screen uniquement)
      resizeMode: "contain",
      backgroundColor: "#000000"
    },
    assetBundlePatterns: [
      "**/*"
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.praxis.app", // Renommé en Praxis
      infoPlist: {
        UIBackgroundModes: ["location", "fetch", "voip"],
        NSLocationAlwaysAndWhenInUseUsageDescription: "Suivi tactique de l'équipe même en arrière-plan.",
        NSLocationWhenInUseUsageDescription: "Affichage position sur carte.",
        NSCameraUsageDescription: "Scan QR Code.",
        NSLocalNetworkUsageDescription: "Nécessaire pour la connexion P2P entre appareils sur le même réseau WiFi."
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png", // On garde l'adaptive standard
        backgroundColor: "#000000"
      },
      package: "com.praxis.app", // Renommé en Praxis
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
        "CHANGE_WIFI_STATE",
        "POST_NOTIFICATIONS"
      ]
    },
    plugins: [
      [
        "expo-location",
        {
          "locationAlwaysAndWhenInUsePermission": "Allow Praxis to use your location for team awareness."
        }
      ],
      [
        "expo-camera",
        {
          "cameraPermission": "Allow Praxis to access your camera for QR scanning."
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
