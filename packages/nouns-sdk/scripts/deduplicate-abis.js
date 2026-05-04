"use strict";
/**
 * This script deduplicates ABI definitions in TypeScript declaration files (*.d.ts, *.d.mts).
 *
 * This is needed to avoid huge declaration files with repeated ABI definitions that are inlined
 * for every single exported function, making the declaration files grow to several MB in size and
 * overwhelming the TypeScript Intellisense in IDEs with the redundancy.
 *
 * ref: https://github.com/microsoft/TypeScript/issues/37151
 */
Object.defineProperty(exports, "__esModule", { value: true });
var fs_1 = require("fs");
var glob_1 = require("glob");
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
function processFile(filePath) {
    var content = (0, fs_1.readFileSync)(filePath, 'utf-8');
    var abiVars = content.matchAll(/declare const ([A-Za-z]*Abi): (readonly (?:.|\n)+?^}]);/gm);
    for (var _i = 0, _a = Array.from(abiVars); _i < _a.length; _i++) {
        var _b = _a[_i], varName = _b[1], abiBody = _b[2];
        var typeName = capitalize(varName);
        if (!abiBody) {
            console.debug("    Warning: Could not extract ABI body for ".concat(varName));
            continue;
        }
        // Insert type alias
        content = content.replace("declare const ".concat(varName, ": ").concat(abiBody, ";"), "declare const ".concat(varName, ": ").concat(abiBody, ";\n\nexport type ").concat(typeName, " = typeof ").concat(varName, ";"));
        // replace all occurrences of the ABI body with the type name
        content = content.replaceAll(abiBody, typeName);
        // replace the first occurrence back to the original ABI body
        content = content.replace(typeName, abiBody);
        // The abi body also appears in the exported config indented with 4 spaces
        var configAbiBody = abiBody.replaceAll('\n', '\n    ');
        content = content.replace(configAbiBody, typeName);
    }
    (0, fs_1.writeFileSync)(filePath, content);
    console.log("Deduplicated abis on ".concat(filePath));
}
function main() {
    var patterns = process.argv.slice(2);
    if (patterns.length === 0) {
        console.error('Usage: tsx deduplicate-abis.ts <pattern1> [pattern2] ...');
        process.exit(1);
    }
    // Expand all glob patterns
    var allFiles = patterns.flatMap(function (pattern) { return (0, glob_1.globSync)(pattern); });
    if (allFiles.length === 0) {
        console.log('No files found matching the provided patterns');
        return;
    }
    for (var _i = 0, allFiles_1 = allFiles; _i < allFiles_1.length; _i++) {
        var file = allFiles_1[_i];
        processFile(file);
    }
    console.log('ABI deduplication complete!');
}
main();
