const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Permet à la mise à jour d'inclure les fichiers CSS et HTML (Assets)
config.resolver.assetExts.push(
  'css', 
  'html'
);

module.exports = config;
