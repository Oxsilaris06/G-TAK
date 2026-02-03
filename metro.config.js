const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const { assetExts, sourceExts } = config.resolver;

// 1. On ajoute css et html aux assets (pour qu'ils soient inclus dans l'update)
config.resolver.assetExts = [...assetExts, 'css', 'html'];

// 2. On s'assure qu'ils ne sont PAS dans les sources (pour éviter les erreurs de compilation)
config.resolver.sourceExts = sourceExts.filter(ext => ext !== 'css' && ext !== 'html');

module.exports = config;
