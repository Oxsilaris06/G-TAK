const { withPodfile, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Plugin pour forcer MapLibre Native SDK en version 6.x avec Support Module
 * Corrige l'erreur "module 'MapLibre' not found" en activant modular_headers
 */
const withMapLibrePodfileFix = (config) => {
  return withPodfile(config, (config) => {
    const podfile = config.modResults.contents;

    // 1. INJECTION DE LA DÉPENDANCE AVEC MODULAR HEADERS
    // L'option :modular_headers => true est CRITIQUE pour que '@import MapLibre' fonctionne
    let newPodfile = podfile;
    if (!newPodfile.includes("pod 'MapLibre'")) {
      newPodfile = newPodfile.replace(
        /use_expo_modules!/,
        `
  # Fix MapLibre pour iOS : Force la version et active les headers modulaires
  pod 'MapLibre', '6.17.1', :modular_headers => true
  
  use_expo_modules!`
      );
    }

    // 2. CONFIGURATION POST_INSTALL ROBUSTE
    const postInstallBlock = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        # 1. Uniformisation de la version iOS minimale (Fix warnings)
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '13.4'
        
        # 2. Désactivation des warnings bloquants
        config.build_settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = "YES"
        config.build_settings['SWIFT_SUPPRESS_WARNINGS'] = "YES"
        
        # 3. Autoriser les inclusions non-modulaires (Indispensable pour MapLibre static)
        config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
        
        # 4. Configuration spécifique pour la cible MapLibre elle-même
        if target.name == 'MapLibre'
          config.build_settings['DEFINES_MODULE'] = 'YES'
          config.build_settings['CLANG_ENABLE_MODULES'] = 'YES'
        end
      end
    end
    `;

    // Insertion du post_install
    if (newPodfile.includes('post_install do |installer|')) {
      newPodfile = newPodfile.replace(
        'post_install do |installer|',
        `post_install do |installer|\n${postInstallBlock}`
      );
    } else {
      newPodfile += `\npost_install do |installer|\n${postInstallBlock}\nend\n`;
    }

    config.modResults.contents = newPodfile;
    return config;
  });
};

/**
 * Plugin pour patcher expo-device (UIDevice.swift)
 * Corrige l'erreur "TARGET_OS_SIMULATOR" sur Xcode 15+
 */
const withExpoDeviceXcode15Fix = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const file = path.join(config.modRequest.projectRoot, 'node_modules/expo-device/ios/UIDevice.swift');
      if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        if (content.includes('return TARGET_OS_SIMULATOR != 0')) {
          content = content.replace('return TARGET_OS_SIMULATOR != 0', 'return false');
          fs.writeFileSync(file, content);
          console.log('✅ Patched expo-device UIDevice.swift for Xcode 15');
        }
      }
      return config;
    },
  ]);
};

// --- CONFIGURATION PRINCIPALE ---
const PROJECT_ID = "f55fd8e2-57c6-4432-a64c-fae41bb16a3e";
const VERSION = "4.1.0";

const config = {
  expo: {
    name: "Praxis",
    slug: "praxis",
    version: VERSION,
    orientation: "default",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    runtimeVersion: VERSION,
    assetBundlePatterns: ["**/*"],
    updates: {
      url: `https://u.expo.dev/${PROJECT_ID}`,
      requestHeaders: { "expo-channel-name": "production" },
      enabled: true,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 30000
    },
    extra: {
      eas: { projectId: PROJECT_ID }
    },
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
      permissions: [
        "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "ACCESS_BACKGROUND_LOCATION",
        "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_LOCATION", "INTERNET", "WAKE_LOCK",
        "CAMERA", "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "VIBRATE",
        "RECEIVE_BOOT_COMPLETED", "POST_NOTIFICATIONS"
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
          },
          ios: {
            newArchEnabled: false,
            // 'static' est requis pour MapLibre v10, mais cause l'erreur de module si mal configuré
            useFrameworks: 'static',
            deploymentTarget: '13.4'
          }
        }
      ],
      [
        "expo-camera",
        { "cameraPermission": "Nécessaire pour scanner les QR Codes de session." }
      ],
      ["@config-plugins/react-native-webrtc", { cameraPermission: false, microphonePermission: false }],
      [
        "expo-location",
        {
          "locationAlwaysAndWhenInUsePermission": "Cette application a besoin de votre position même en arrière-plan pour le suivi tactique continu.",
          "isIosBackgroundLocationEnabled": true,
          "isAndroidBackgroundLocationEnabled": true
        }
      ],
      "expo-notifications",
      "expo-task-manager"
    ]
  }
};

module.exports = withMapLibrePodfileFix(withExpoDeviceXcode15Fix(config));
