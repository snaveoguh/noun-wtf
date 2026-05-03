"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.useMDXComponents = useMDXComponents;
var nextra_theme_docs_1 = require("nextra-theme-docs");
// Get the default MDX components
var themeComponents = (0, nextra_theme_docs_1.useMDXComponents)();
// Merge components
function useMDXComponents(components) {
    if (components === void 0) { components = {}; }
    return __assign(__assign({}, themeComponents), components);
}
