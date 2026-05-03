"use strict";
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
exports.handler = handler;
var blobs_1 = require("@netlify/blobs");
var STORE_NAME = 'noun-day-drafts';
var META_KEY = 'all-drafts';
var FALLBACK_URL = 'https://noun.wtf/.netlify/functions/noun-day-drafts';
var headers = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
};
function json(body, statusCode) {
    if (statusCode === void 0) { statusCode = 200; }
    return {
        body: JSON.stringify(body),
        headers: headers,
        statusCode: statusCode,
    };
}
function parseBody(event) {
    var _a;
    return JSON.parse((_a = event.body) !== null && _a !== void 0 ? _a : '{}');
}
function getRequestUrl(event) {
    var _a;
    return new URL((_a = event.rawUrl) !== null && _a !== void 0 ? _a : FALLBACK_URL);
}
function readDrafts(store) {
    return __awaiter(this, void 0, void 0, function () {
        var raw;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, store.get(META_KEY)];
                case 1:
                    raw = _a.sent();
                    if (!raw)
                        return [2 /*return*/, {}];
                    return [2 /*return*/, JSON.parse(raw)];
            }
        });
    });
}
function handler(event) {
    return __awaiter(this, void 0, void 0, function () {
        var store, url, nounId, drafts, _a, body, drafts, nounId, key, existing, updatedAt, error_1, message;
        var _b, _c, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    if (event.httpMethod === 'OPTIONS') {
                        return [2 /*return*/, {
                                body: '',
                                headers: headers,
                                statusCode: 204,
                            }];
                    }
                    (0, blobs_1.connectLambda)({
                        blobs: (_b = event.blobs) !== null && _b !== void 0 ? _b : '',
                        headers: (_c = event.headers) !== null && _c !== void 0 ? _c : {},
                    });
                    store = (0, blobs_1.getStore)(STORE_NAME);
                    if (!(event.httpMethod === 'GET')) return [3 /*break*/, 4];
                    _f.label = 1;
                case 1:
                    _f.trys.push([1, 3, , 4]);
                    url = getRequestUrl(event);
                    nounId = Number(url.searchParams.get('nounId'));
                    if (!Number.isFinite(nounId)) {
                        return [2 /*return*/, json({ error: 'nounId required' }, 400)];
                    }
                    return [4 /*yield*/, readDrafts(store)];
                case 2:
                    drafts = _f.sent();
                    return [2 /*return*/, json((_d = drafts[String(nounId)]) !== null && _d !== void 0 ? _d : null)];
                case 3:
                    _a = _f.sent();
                    return [2 /*return*/, json(null)];
                case 4:
                    if (!(event.httpMethod === 'PUT')) return [3 /*break*/, 9];
                    _f.label = 5;
                case 5:
                    _f.trys.push([5, 8, , 9]);
                    body = parseBody(event);
                    if (!Number.isFinite(body.nounId)) {
                        return [2 /*return*/, json({ error: 'nounId required' }, 400)];
                    }
                    if (body.mode !== '2d' && body.mode !== '3d') {
                        return [2 /*return*/, json({ error: 'mode must be 2d or 3d' }, 400)];
                    }
                    if (!body.image || !body.image.startsWith('data:image/')) {
                        return [2 /*return*/, json({ error: 'image data URL required' }, 400)];
                    }
                    if (!Array.isArray(body.pixels) || body.pixels.length !== 32) {
                        return [2 /*return*/, json({ error: '32x32 pixels grid required' }, 400)];
                    }
                    if (body.mode === '3d' && (!body.voxelData || typeof body.voxelData !== 'string')) {
                        return [2 /*return*/, json({ error: 'voxelData required for 3d drafts' }, 400)];
                    }
                    return [4 /*yield*/, readDrafts(store)];
                case 6:
                    drafts = _f.sent();
                    nounId = Number(body.nounId);
                    key = String(nounId);
                    existing = (_e = drafts[key]) !== null && _e !== void 0 ? _e : { nounId: nounId };
                    updatedAt = new Date().toISOString();
                    if (body.mode === '2d') {
                        existing.pixel = {
                            image: body.image,
                            pixels: body.pixels,
                            updatedAt: updatedAt,
                        };
                    }
                    else {
                        existing.voxel = {
                            image: body.image,
                            pixels: body.pixels,
                            updatedAt: updatedAt,
                            voxelData: body.voxelData,
                        };
                    }
                    drafts[key] = existing;
                    return [4 /*yield*/, store.set(META_KEY, JSON.stringify(drafts))];
                case 7:
                    _f.sent();
                    return [2 /*return*/, json(existing)];
                case 8:
                    error_1 = _f.sent();
                    message = error_1 instanceof Error ? error_1.message : 'Failed to save draft';
                    return [2 /*return*/, json({ error: message }, 500)];
                case 9: return [2 /*return*/, json({ error: 'Method not allowed' }, 405)];
            }
        });
    });
}
