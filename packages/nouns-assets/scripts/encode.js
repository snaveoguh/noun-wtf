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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var sdk_1 = require("@nouns/sdk");
var fs_1 = require("fs");
var path_1 = require("path");
var utils_1 = require("./utils");
var DESTINATION = path_1.default.join(__dirname, '../src/image-data.json');
var encode = function () { return __awaiter(void 0, void 0, void 0, function () {
    var encoder, partfolders, _i, partfolders_1, folder, folderpath, files, _a, files_1, file, image;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0:
                encoder = new sdk_1.PNGCollectionEncoder();
                partfolders = ['1-bodies', '2-accessories', '3-heads', '4-glasses'];
                _i = 0, partfolders_1 = partfolders;
                _b.label = 1;
            case 1:
                if (!(_i < partfolders_1.length)) return [3 /*break*/, 7];
                folder = partfolders_1[_i];
                folderpath = path_1.default.join(__dirname, '../images/v0', folder);
                return [4 /*yield*/, fs_1.promises.readdir(folderpath)];
            case 2:
                files = _b.sent();
                _a = 0, files_1 = files;
                _b.label = 3;
            case 3:
                if (!(_a < files_1.length)) return [3 /*break*/, 6];
                file = files_1[_a];
                return [4 /*yield*/, (0, utils_1.readPngImage)(path_1.default.join(folderpath, file))];
            case 4:
                image = _b.sent();
                encoder.encodeImage(file.replace(/\.png$/, ''), image, folder.replace(/^\d-/, ''));
                _b.label = 5;
            case 5:
                _a++;
                return [3 /*break*/, 3];
            case 6:
                _i++;
                return [3 /*break*/, 1];
            case 7: return [4 /*yield*/, fs_1.promises.writeFile(DESTINATION, JSON.stringify(__assign({ bgcolors: ['d5d7e1', 'e1d7d5'] }, encoder.data), null, 2))];
            case 8:
                _b.sent();
                return [2 /*return*/];
        }
    });
}); };
encode();
