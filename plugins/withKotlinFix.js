const { withProjectBuildGradle } = require('@expo/config-plugins');

module.exports = function withKotlinFix(config) {
    return withProjectBuildGradle(config, (config) => {
        if (config.modResults.language === 'groovy') {
            let contents = config.modResults.contents;

            // 1. Force variable definition
            contents = contents.replace(
                /kotlinVersion\s*=\s*['"][\d.]+['"]/g,
                `kotlinVersion = "1.9.24"`
            );

            // 2. Hard replace configuration classpath
            contents = contents.replace(
                /classpath\s*\(['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin:.*['"]\)/g,
                `classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.24")`
            );

            // 3. Inject Resolution Strategy & Compiler Options
            const extraConfig = `
        allprojects {
            // Force resolution strategy
            configurations.all {
                resolutionStrategy.eachDependency { details ->
                    if (details.requested.group == 'org.jetbrains.kotlin' && details.requested.name == 'kotlin-gradle-plugin') {
                        details.useVersion "1.9.24"
                    }
                    if (details.requested.group == 'org.jetbrains.kotlin' && details.requested.name.startsWith('kotlin-stdlib')) {
                        details.useVersion "1.9.24"
                    }
                }
            }

            // Force compiler suppression
            tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
                kotlinOptions {
                    jvmTarget = "1.8"
                    freeCompilerArgs += [
                        "-P",
                        "plugin:androidx.compose.compiler.plugins.kotlin:suppressKotlinVersionCompatibilityCheck=1.9.25"
                    ]
                }
            }
        }
      `;

            if (!contents.includes('resolutionStrategy.eachDependency')) {
                contents += `\n${extraConfig}\n`;
            }

            config.modResults.contents = contents;
        }
        return config;
    });
};
