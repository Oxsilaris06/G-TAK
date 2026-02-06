const { withPodfile, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const glob = require('glob'); // Assurez-vous que glob est dispo ou on utilise une fonction custom

/**
 * PLUGIN CRITIQUE : Patch le code source de @maplibre/maplibre-react-native
 * Remplace l'import de module (@import) par un import de header (#import)
 * Indispensable pour le mode 'useFrameworks: static'
 */
const withMapLibreImportPatch = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      console.log('🚑 Patching MapLibre source files for static framework compatibility...');
      const libPath = path.join(config.modRequest.projectRoot, 'node_modules/@maplibre/maplibre-react-native/ios');
      
      // Fonction récursive simple pour trouver les fichiers .h et .m
      const getAllFiles = (dirPath, arrayOfFiles) => {
        files = fs.readdirSync(dirPath);
        arrayOfFiles = arrayOfFiles || [];
        files.forEach((file) => {
          if (fs.statSync(dirPath + "/" + file).isDirectory()) {
            arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
          } else {
            if (file.endsWith('.h') || file.endsWith('.m') || file.endsWith('.mm')) {
              arrayOfFiles.push(path.join(dirPath, "/", file));
            }
          }
        });
        return arrayOfFiles;
      };

      try {
        const files = getAllFiles(libPath);
        let patchedCount = 0;
        
        files.forEach(file => {
          let content = fs.readFileSync(file, 'utf8');
          if (content.includes('@import MapLibre;')) {
            // Le remplacement magique
            content = content.replace(/@import MapLibre;/g, '#import <MapLibre/MapLibre.h>');
            fs.writeFileSync(file, content, 'utf8');
            patchedCount++;
          }
        });
        console.log(`✅ Patch appliqué sur ${patchedCount} fichiers MapLibre.`);
      } catch (e) {
        console.error("⚠️ Erreur lors du patch MapLibre:", e);
        // On ne bloque pas le build ici, mais ça risque de planter plus tard
      }

      return config;
    },
  ]);
};

/**
 * Plugin pour forcer MapLibre Native SDK en version 6.x dans le Podfile
 */
const withMapLibrePodfileFix = (config) => {
  return withPodfile(config, (config) => {
    const podfile = config.modResults.contents;

    // 1. Injection de la dépendance MapLibre 6.17.1
    // On garde :modular_headers => true car ça aide certains linkers, même si on a patché le code
    let newPodfile = podfile;
    if (!newPodfile.includes("pod 'MapLibre'")) {
      newPodfile = newPodfile.replace(
        /use_expo_modules!/,
        `
  # Fix MapLibre Version for iOS
  pod 'MapLibre', '6.17.1', :modular_headers => true
  
  use_expo_modules!`
      );
    }

    // 2. Bloc post_install pour nettoyer les warnings et forcer la compatibilité
    const postInstallBlock = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '13.4'
        config.build_settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = "YES"
        config.build_settings['SWIFT_SUPPRESS_WARNINGS'] = "YES"
        
        # CRITIQUE : Autorise l'import de headers non-modulaires dans les frameworks
        config.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
        
        # Fix pour MapLibre static linkage
        if target.name == 'MapLibre'
          config.build_settings['DEFINES_MODULE'] = 'YES'
        end
      end
    end
    `;

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
 * Plugin pour patcher expo-device (Xcode 15 fix)
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

module.exports = withMapLibrePodfileFix(withExpoDeviceXcode15Fix(withMapLibreImportPatch(config)));
