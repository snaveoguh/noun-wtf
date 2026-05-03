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
exports.handler = handler;
var blobs_1 = require("@netlify/blobs");
var STORE_NAME = 'noun-links';
var META_KEY = 'all-links';
var FALLBACK_URL = 'https://noun.wtf/.netlify/functions/noun-links';
var headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};
// ── OG meta scraper ─────────────────────────────────────────────────────
function scrapeOG(url) {
    return __awaiter(this, void 0, void 0, function () {
        var res, html, imageMatch, titleMatch, _a;
        var _b;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 3, , 4]);
                    return [4 /*yield*/, fetch(url, {
                            headers: { 'User-Agent': 'noun-wtf-bot/1.0 (OG scraper)' },
                            redirect: 'follow',
                            signal: AbortSignal.timeout(8000),
                        })];
                case 1:
                    res = _c.sent();
                    if (!res.ok)
                        return [2 /*return*/, {}];
                    return [4 /*yield*/, res.text()];
                case 2:
                    html = _c.sent();
                    imageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
                        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
                    titleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
                        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
                        html.match(/<title[^>]*>([^<]+)<\/title>/i);
                    return [2 /*return*/, {
                            ogImage: (imageMatch === null || imageMatch === void 0 ? void 0 : imageMatch[1]) || undefined,
                            ogTitle: ((_b = titleMatch === null || titleMatch === void 0 ? void 0 : titleMatch[1]) === null || _b === void 0 ? void 0 : _b.trim()) || undefined,
                        }];
                case 3:
                    _a = _c.sent();
                    return [2 /*return*/, {}];
                case 4: return [2 /*return*/];
            }
        });
    });
}
// ── Handler ─────────────────────────────────────────────────────────────
function handleRequest(req) {
    return __awaiter(this, void 0, void 0, function () {
        var store, url, nounId_1, raw, all, filtered, body, trimmedName, og, link, raw, all, id_1, raw, all, filtered;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    if (req.method === 'OPTIONS') {
                        return [2 /*return*/, new Response(null, { status: 204, headers: headers })];
                    }
                    store = (0, blobs_1.getStore)(STORE_NAME);
                    url = new URL(req.url);
                    if (!(req.method === 'GET')) return [3 /*break*/, 2];
                    nounId_1 = url.searchParams.get('nounId');
                    if (!nounId_1)
                        return [2 /*return*/, new Response(JSON.stringify([]), { headers: headers })];
                    return [4 /*yield*/, store.get(META_KEY)];
                case 1:
                    raw = _b.sent();
                    if (!raw)
                        return [2 /*return*/, new Response(JSON.stringify([]), { headers: headers })];
                    all = JSON.parse(raw);
                    filtered = all
                        .filter(function (l) { return l.nounId === Number(nounId_1); })
                        .sort(function (a, b) { return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(); });
                    return [2 /*return*/, new Response(JSON.stringify(filtered), { headers: headers })];
                case 2:
                    if (!(req.method === 'POST')) return [3 /*break*/, 7];
                    return [4 /*yield*/, req.json()];
                case 3:
                    body = (_b.sent());
                    if (!body.nounId || !body.url) {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'nounId and url required' }), {
                                status: 400,
                                headers: headers,
                            })];
                    }
                    // Validate URL
                    try {
                        new URL(body.url);
                    }
                    catch (_c) {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers: headers })];
                    }
                    trimmedName = (_a = body.name) === null || _a === void 0 ? void 0 : _a.trim();
                    if (trimmedName && trimmedName.length > 60) {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'Name too long' }), { status: 400, headers: headers })];
                    }
                    return [4 /*yield*/, scrapeOG(body.url)];
                case 4:
                    og = _b.sent();
                    link = __assign(__assign({ id: "".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 8)), nounId: body.nounId, url: body.url }, (trimmedName ? { name: trimmedName } : {})), { ogImage: og.ogImage, ogTitle: og.ogTitle, createdAt: new Date().toISOString() });
                    return [4 /*yield*/, store.get(META_KEY)];
                case 5:
                    raw = _b.sent();
                    all = raw ? JSON.parse(raw) : [];
                    all.unshift(link);
                    return [4 /*yield*/, store.set(META_KEY, JSON.stringify(all))];
                case 6:
                    _b.sent();
                    return [2 /*return*/, new Response(JSON.stringify(link), { status: 201, headers: headers })];
                case 7:
                    if (!(req.method === 'DELETE')) return [3 /*break*/, 10];
                    id_1 = url.searchParams.get('id');
                    if (!id_1)
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: headers })];
                    return [4 /*yield*/, store.get(META_KEY)];
                case 8:
                    raw = _b.sent();
                    if (!raw)
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: headers })];
                    all = JSON.parse(raw);
                    filtered = all.filter(function (l) { return l.id !== id_1; });
                    if (filtered.length === all.length) {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: headers })];
                    }
                    return [4 /*yield*/, store.set(META_KEY, JSON.stringify(filtered))];
                case 9:
                    _b.sent();
                    return [2 /*return*/, new Response(JSON.stringify({ ok: true }), { headers: headers })];
                case 10: return [2 /*return*/, new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: headers })];
            }
        });
    });
}
function handler(event) {
    return __awaiter(this, void 0, void 0, function () {
        var method, request, response;
        var _a;
        var _b, _c, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0:
                    method = event.httpMethod || 'GET';
                    (0, blobs_1.connectLambda)({
                        blobs: (_b = event.blobs) !== null && _b !== void 0 ? _b : '',
                        headers: (_c = event.headers) !== null && _c !== void 0 ? _c : {},
                    });
                    request = new Request((_d = event.rawUrl) !== null && _d !== void 0 ? _d : FALLBACK_URL, __assign({ method: method }, (method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
                        ? {}
                        : {
                            body: (_e = event.body) !== null && _e !== void 0 ? _e : undefined,
                            headers: { 'Content-Type': 'application/json' },
                        })));
                    return [4 /*yield*/, handleRequest(request)];
                case 1:
                    response = _f.sent();
                    _a = {};
                    return [4 /*yield*/, response.text()];
                case 2: return [2 /*return*/, (_a.body = _f.sent(),
                        _a.headers = Object.fromEntries(response.headers.entries()),
                        _a.statusCode = response.status,
                        _a)];
            }
        });
    });
}
