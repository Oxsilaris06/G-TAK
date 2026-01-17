export default {
  expo: {
    name: "Praxis",
    slug: "praxis",
    version: "4.0.0",
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
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
      // Permissions réduites au strict nécessaire pour la Data
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "INTERNET",
        "WAKE_LOCK"
      ]
    },
    plugins: [
      [
        "expo-build-properties",
        {
          android: {
            kotlinVersion: "2.1.0",
            compileSdkVersion: 35,
            targetSdkVersion: 35,
            buildToolsVersion: "35.0.0",
            // Activation du nouveau moteur pour de meilleures performances Data
            newArchEnabled: true
          }
        }
      ],
      [
        "@config-plugins/react-native-webrtc",
        {
          // Désactivation des permissions micro/caméra si vous ne faites que de la data
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
