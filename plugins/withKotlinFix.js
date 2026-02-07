const { withProjectBuildGradle } = require('@expo/config-plugins');

module.exports = function withKotlinFix(config) {
    return withProjectBuildGradle(config, (config) => {
        if (config.modResults.language === 'groovy') {
            let contents = config.modResults.contents;

            // 1. Force variable definition
            // Matches: kotlinVersion = "1.x.x" or '1.x.x'
            contents = contents.replace(
                /kotlinVersion\s*=\s*['"][\d.]+['"]/g,
                `kotlinVersion = "1.9.24"`
            );

            // 2. Hard replace configuration classpath if it uses the variable
            contents = contents.replace(
                /classpath\s*\(['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin:.*['"]\)/g,
                `classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.24")`
            );

            // 3. Inject Resolution Strategy
            const resolutionStrategy = `
        allprojects {
            configurations.all {
                resolutionStrategy.eachDependency { details ->
                    if (details.requested.group == 'org.jetbrains.kotlin' && details.requested.name == 'kotlin-gradle-plugin') {
                        details.useVersion "1.9.24"
                    }
                }
            }
        }
      `;

            // Insert resolution strategy at the end of buildscript or allprojects
            if (!contents.includes('resolutionStrategy.eachDependency')) {
                contents += `\n${resolutionStrategy}\n`;
            }

            config.modResults.contents = contents;
        }
        return config;
    });
};
