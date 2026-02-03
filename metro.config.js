const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const { assetExts, sourceExts } = config.resolver;

// Assets supplémentaires
config.resolver.assetExts = [...assetExts, 'css', 'html', 'mbtiles', 'pbf'];

// Source extensions
config.resolver.sourceExts = sourceExts.filter(ext => ext !== 'css' && ext !== 'html');

// Optimisation du bundler
config.transformer.minifierConfig = {
  keep_classnames: true,
  keep_fnames: true,
  mangle: {
    keep_classnames: true,
    keep_fnames: true,
  },
};

// Cache optimization
config.cacheStores = [
  require('metro-cache').FileStore({
    root: require('path').join(__dirname, '.metro-cache'),
  }),
];

module.exports = config;
