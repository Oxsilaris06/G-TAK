const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// On s'assure que les fichiers css et js (pour leaflet) sont bien traités comme des assets
// et non comme du code source à compiler par le bundler natif.
config.resolver.assetExts.push(
  'css', 
  'html' // Au cas où vous auriez du HTML local
);

// On exclut ces extensions du code source pour éviter les conflits
// (Note: on garde 'js' et 'ts' dans sourceExts évidemment, mais 'css' va dans assets)

module.exports = config;
