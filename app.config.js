const { withPodfile, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Plugin pour forcer MapLibre Native SDK en version 6.x et configurer le compilateur iOS
 * Indispensable pour la compatibilité iOS 17+ et Xcode 15/16
 */
const withMapLibrePodfileFix = (config) => {
  return withPodfile(config, (config) => {
    const podfile = config.modResults.contents;

    // 1. On injecte la dépendance spécifique MapLibre 6.17.1
    // On doit l'insérer avant 'use_expo_modules!' pour qu'elle prenne la précédence
    let newPodfile = podfile;
    if (!newPodfile.includes("pod 'MapLibre'")) {
      newPodfile = newPodfile.replace(
        /use_expo_modules!/,
        `
  # Fix MapLibre Version for iOS 17+ compatibility
  pod 'MapLibre', '6.17.1'
  
  use_expo_modules!`
      );
    }

    // 2. Bloc post_install pour nettoyer les warnings et forcer la compatibilité
    const postInstallBlock = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '13.4'
        
        # Désactiver les warnings bloquants (Critical for CI)
        config.build_settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = "YES"
        config.build_settings['SWIFT_SUPPRESS_WARNINGS'] = "YES"
        
        # Autoriser les inclusions non-modulaires (Fix pour MapLibre static framework)
        config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
        
        # Fix pour Xcode 15+ Linker
        config.build_settings['OTHER_LDFLAGS'] ||= ['$(inherited)']
        config.build_settings['OTHER_LDFLAGS'] << '-ld64'
      end
    end
    `;

    // Insertion intelligente du post_install
    if (newPodfile.includes('post_install do |installer|')) {
      // Si un bloc existe déjà (souvent créé par expo-build-properties), on insère notre code dedans
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
 * Corrige l'erreur "TARGET_OS_SIMULATOR" sur Xcode 15+ pour les builds physiques
 */
const withExpoDeviceXcode15Fix = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const file = path.join(config.modRequest.projectRoot, 'node_modules/expo-device/ios/UIDevice.swift');
      if (fs.existsSync(file)) {
        let content = fs.readFileSync(file, 'utf8');
        // Remplacement safe : si on compile pour device, TARGET_OS_SIMULATOR n'est pas nécessaire
        // On force le retour à false pour éviter l'erreur de scope
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
            // CRITIQUE : useFrameworks: 'static' active automatiquement les Modules
            // Ne PAS faire de patch manuel sur les imports MapLibre quand ceci est activé
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

// Application des plugins custom
// L'ordre est important : Device Fix d'abord, puis configuration du Podfile
module.exports = withMapLibrePodfileFix(withExpoDeviceXcode15Fix(config));
