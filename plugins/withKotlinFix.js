const { withProjectBuildGradle } = require('@expo/config-plugins');

module.exports = function withKotlinFix(config) {
    return withProjectBuildGradle(config, (config) => {
        if (config.modResults.language === 'groovy') {
            config.modResults.contents = config.modResults.contents.replace(
                /kotlinVersion\s*=\s*['"][\d.]+['"]/g,
                `kotlinVersion = "1.9.24"`
            );
        }
        return config;
    });
};
