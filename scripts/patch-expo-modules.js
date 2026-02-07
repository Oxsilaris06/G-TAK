const fs = require('fs');
const path = require('path');

// Target file: node_modules/expo-modules-core/android/build.gradle
const expoModulesCorePath = path.resolve(__dirname, '../node_modules/expo-modules-core/android/build.gradle');

if (fs.existsSync(expoModulesCorePath)) {
    let content = fs.readFileSync(expoModulesCorePath, 'utf8');

    // Check if already patched to avoid duplication
    if (!content.includes('plugin:androidx.compose.compiler.plugins.kotlin')) {
        console.log('Patching expo-modules-core/android/build.gradle...');

        // Append compiler suppression logic
        const patch = `
// [PATCH] Suppress Kotlin version check for Compose Compiler
afterEvaluate { project ->
    project.tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
        kotlinOptions {
            freeCompilerArgs += [
                "-P",
                "plugin:androidx.compose.compiler.plugins.kotlin:suppressKotlinVersionCompatibilityCheck=1.9.25"
            ]
        }
    }
}
`;
        fs.appendFileSync(expoModulesCorePath, patch);
        console.log('Successfully patched expo-modules-core to suppress Kotlin version check.');
    } else {
        console.log('expo-modules-core already patched.');
    }
} else {
    console.log('Warning: expo-modules-core/android/build.gradle not found. Skipping patch.');
}
