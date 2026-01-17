export default {
  expo: {
    name: "Praxis",
    slug: "praxis",
    version: "3.3.0",
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    splash: {
      image: "./assets/icon2.png",
      resizeMode: "contain",
      backgroundColor: "#000000"
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.praxis.app",
      infoPlist: {
        UIBackgroundModes: ["location", "fetch", "voip"],
        NSLocationAlwaysAndWhenInUseUsageDescription: "Suivi tactique de l'équipe même en arrière-plan.",
        NSLocalNetworkUsageDescription: "Nécessaire pour la connexion P2P."
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#000000"
      },
      package: "com.praxis.app",
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "CAMERA",
        "FOREGROUND_SERVICE",
        "RECORD_AUDIO",
        "MODIFY_AUDIO_SETTINGS"
      ]
    },
    plugins: [
      [
        "expo-build-properties",
        {
          android: {
            // Ici, on force la version de Kotlin compatible avec Gradle 8/9
            kotlinVersion: "1.9.24", 
            // On peut aussi forcer le support du nouveau moteur d'architecture
            newArchEnabled: false 
          }
        }
      ],
      ["expo-location", { "locationAlwaysAndWhenInUsePermission": "Allow Praxis to use location." }],
      ["expo-camera", { "cameraPermission": "Allow Praxis to access camera." }],
      "expo-notifications",
      "@config-plugins/react-native-webrtc"
    ]
  }
};
