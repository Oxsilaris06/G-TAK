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
        UIBackgroundModes: ["location", "fetch", "voip"],
        NSLocationAlwaysAndWhenInUseUsageDescription: "Suivi tactique de l'équipe.",
        NSLocationWhenInUseUsageDescription: "Affichage position sur carte.",
        NSCameraUsageDescription: "Scan QR Code & WebRTC.",
        NSMicrophoneUsageDescription: "Audio WebRTC."
      }
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#000000"
      },
      package: "com.comtac.sa",
      permissions: [
        "ACCESS_COARSE_LOCATION",
        "ACCESS_FINE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "CAMERA",
        "RECORD_AUDIO",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "WAKE_LOCK",
        "VIBRATE",
        "INTERNET",
        "ACCESS_NETWORK_STATE",
        "ACCESS_WIFI_STATE",
        "POST_NOTIFICATIONS",
        "MODIFY_AUDIO_SETTINGS"
      ]
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
      "expo-notifications",
      [
        "expo-build-properties",
        {
          "android": {
            "compileSdkVersion": 34,
            "targetSdkVersion": 34,
            "buildToolsVersion": "34.0.0",
            "kotlinVersion": "1.8.0" 
          }
        }
      ],
      "@config-plugins/react-native-webrtc"
    ],
    extra: {
      eas: {
        projectId: "your-project-id"
      }
    }
  }
};
