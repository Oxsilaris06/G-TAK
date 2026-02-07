const { withPodfile, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Plugin pour ajouter un post_install hook au Podfile
 * Cela force les modular headers sur MapLibre et configure correctement les pods
 */
/**
 * Plugin pour ajouter un post_install hook au Podfile
 * Cela force les modular headers sur MapLibre et configure correctement les pods
 */
const withMapLibreFix = (config) => {
  return withPodfile(config, (config) => {
    let podfile = config.modResults.contents;

    // Contenu à injecter pour MapLibre
    const mapLibreFixContent = `
    # Fix MapLibre configuration
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        
        if target.name == 'MapLibre'
          config.build_settings['DEFINES_MODULE'] = 'YES'
          config.build_settings['CLANG_ENABLE_MODULES'] = 'YES'
        end
      end
    end
    
    installer.pod_targets.each do |pod|
      if pod.name == 'MapLibre'
        def pod.build_type
          Pod::BuildType.static_framework
        end
      end
    end
`;

    if (podfile.includes('post_install do |installer|')) {
      // Injecter dans le hook existant
      console.log('✅ Injecting MapLibre fix into existing post_install hook');
      podfile = podfile.replace(
        'post_install do |installer|',
        `post_install do |installer|${mapLibreFixContent}`
      );
    } else {
      // Créer le hook s'il n'existe pas
      console.log('✅ Creating new post_install hook for MapLibre');
      podfile += `
post_install do |installer|${mapLibreFixContent}
end
`;
    }

    config.modResults.contents = podfile;
    return config;
  });
};

/**
 * Plugin pour patcher expo-device automatiquement lors du prebuild
 * Fix pour l'erreur "cannot find 'TARGET_OS_SIMULATOR' in scope" avec Xcode 15+
 */
const withExpoDevicePatch = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const deviceSwiftPath = path.join(
        projectRoot,
        'node_modules',
        'expo-device',
        'ios',
        'UIDevice.swift'
      );

      if (fs.existsSync(deviceSwiftPath)) {
        let content = fs.readFileSync(deviceSwiftPath, 'utf8');

        // Patch pour Xcode 15+ : remplacer TARGET_OS_SIMULATOR par false
        if (content.includes('TARGET_OS_SIMULATOR')) {
          content = content.replace(
            /return TARGET_OS_SIMULATOR != 0/g,
            'return false'
          );
          fs.writeFileSync(deviceSwiftPath, content, 'utf8');
          console.log('✅ expo-device patched for Xcode 15+ compatibility');
        }
      }

      return config;
    },
  ]);
};

// ID PROJET VALIDE
const PROJECT_ID = "f55fd8e2-57c6-4432-a64c-fae41bb16a3e";
const VERSION = "4.1.0";

export default withExpoDevicePatch(withMapLibreFix({
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

    // Configuration iOS
    ios: {
      bundleIdentifier: "com.praxis.app",
      supportsTablet: true,
      infoPlist: {
        UIBackgroundModes: ["location", "fetch", "remote-notification"],
        NSLocationWhenInUseUsageDescription: "Cette application a besoin de votre position pour le suivi tactique.",
        NSLocationAlwaysAndWhenInUseUsageDescription: "Cette application a besoin de votre position même en arrière-plan pour le suivi tactique continu.",
        NSLocationAlwaysUsageDescription: "Cette application a besoin de votre position en arrière-plan pour le suivi tactique.",
        NSCameraUsageDescription: "Nécessaire pour scanner les QR Codes de session.",
        NSPhotoLibraryUsageDescription: "Nécessaire pour ajouter des photos aux pings.",
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
      metaData: {
        "expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH": "ALWAYS",
        "expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS": "30000",
        "expo.modules.updates.EXPO_UPDATES_URL": `https://u.expo.dev/${PROJECT_ID}`,
        "expo.modules.updates.EXPO_UPDATES_CHANNEL_NAME": "production",
        "expo.modules.updates.EXPO_RUNTIME_VERSION": VERSION
      },
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_LOCATION",
        "INTERNET",
        "WAKE_LOCK",
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE",
        "VIBRATE",
        "RECEIVE_BOOT_COMPLETED",
        "POST_NOTIFICATIONS"
      ]
    },

    plugins: [
      [
        "expo-build-properties",
        {
          android: {
            compileSdkVersion: 35,
            targetSdkVersion: 35,
            buildToolsVersion: "35.0.0",
            newArchEnabled: true,
            gradleProperties: [
              { key: 'org.gradle.jvmargs', value: '-Xmx6144m -XX:MaxMetaspaceSize=512m' },
              // { key: 'kotlinVersion', value: '1.9.24' } // Let the plugin handle this
            ]
          },
          ios: {
            deploymentTarget: '15.1'
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
      [
        "expo-location",
        {
          "locationAlwaysAndWhenInUsePermission": "Cette application a besoin de votre position même en arrière-plan pour le suivi tactique continu.",
          "locationWhenInUsePermission": "Cette application a besoin de votre position pour le suivi tactique.",
          "isIosBackgroundLocationEnabled": true,
          "isAndroidBackgroundLocationEnabled": true
        }
      ],
      [
        "expo-notifications",
        {
          "icon": "./assets/adaptive-icon.png",
          "color": "#000000",

        }
      ],
      "expo-task-manager"
    ]
  }
}));
