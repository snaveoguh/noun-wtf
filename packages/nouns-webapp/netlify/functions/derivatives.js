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
// ── IPFS pinning via Pinata ─────────────────────────────────────────────
function pinToIPFS(data_1, filename_1) {
    return __awaiter(this, arguments, void 0, function (data, filename, isJSON) {
        var PINATA_JWT, res_1, result_1, formData, blob, res, result;
        if (isJSON === void 0) { isJSON = false; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    PINATA_JWT = process.env.PINATA_JWT;
                    if (!PINATA_JWT)
                        throw new Error('PINATA_JWT not configured');
                    if (!isJSON) return [3 /*break*/, 3];
                    return [4 /*yield*/, fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: "Bearer ".concat(PINATA_JWT),
                            },
                            body: JSON.stringify({
                                pinataContent: JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)),
                                pinataMetadata: { name: filename },
                            }),
                        })];
                case 1:
                    res_1 = _a.sent();
                    if (!res_1.ok)
                        throw new Error("Pinata JSON pin failed: ".concat(res_1.status));
                    return [4 /*yield*/, res_1.json()];
                case 2:
                    result_1 = _a.sent();
                    return [2 /*return*/, result_1.IpfsHash];
                case 3:
                    formData = new FormData();
                    blob = new Blob([data]);
                    formData.append('file', blob, filename);
                    formData.append('pinataMetadata', JSON.stringify({ name: filename }));
                    return [4 /*yield*/, fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
                            method: 'POST',
                            headers: { Authorization: "Bearer ".concat(PINATA_JWT) },
                            body: formData,
                        })];
                case 4:
                    res = _a.sent();
                    if (!res.ok)
                        throw new Error("Pinata file pin failed: ".concat(res.status));
                    return [4 /*yield*/, res.json()];
                case 5:
                    result = _a.sent();
                    return [2 /*return*/, result.IpfsHash];
            }
        });
    });
}
var STORE_NAME = 'noun-derivatives';
var META_KEY = 'all-derivatives';
var FALLBACK_URL = 'https://noun.wtf/.netlify/functions/derivatives';
// CORS headers for the Vite dev server and production
var corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};
function handleRequest(req) {
    return __awaiter(this, void 0, void 0, function () {
        var store, raw, derivatives, url, nounIdParam, nounId_1, _a, body, _b, name_1, image, nounId, auctionUrl, voxelData, derivatives, raw, _c, trimmedAuctionUrl, newDerivative, err_1, body, _d, id_1, auctionUrl, tokenId, tokenURI, trimmedUrl, raw, derivatives, idx, _e, body, id_2, raw, derivatives, deriv, base64Match, ext, b64, imageBytes, imageHash, metadata, metadataHash, tokenURI, idx, err_2, msg;
        var _f, _g;
        return __generator(this, function (_h) {
            switch (_h.label) {
                case 0:
                    // Handle CORS preflight
                    if (req.method === 'OPTIONS') {
                        return [2 /*return*/, new Response(null, { status: 204, headers: corsHeaders })];
                    }
                    store = (0, blobs_1.getStore)(STORE_NAME);
                    if (!(req.method === 'GET')) return [3 /*break*/, 4];
                    _h.label = 1;
                case 1:
                    _h.trys.push([1, 3, , 4]);
                    return [4 /*yield*/, store.get(META_KEY)];
                case 2:
                    raw = _h.sent();
                    derivatives = raw ? JSON.parse(raw) : [];
                    url = new URL(req.url);
                    nounIdParam = url.searchParams.get('nounId');
                    if (nounIdParam !== null) {
                        nounId_1 = parseInt(nounIdParam, 10);
                        if (!isNaN(nounId_1)) {
                            derivatives = derivatives.filter(function (d) { return d.nounId === nounId_1; });
                        }
                    }
                    return [2 /*return*/, new Response(JSON.stringify(derivatives), {
                            headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                        })];
                case 3:
                    _a = _h.sent();
                    return [2 /*return*/, new Response(JSON.stringify([]), {
                            headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                        })];
                case 4:
                    if (!(req.method === 'POST')) return [3 /*break*/, 13];
                    _h.label = 5;
                case 5:
                    _h.trys.push([5, 12, , 13]);
                    return [4 /*yield*/, req.json()];
                case 6:
                    body = _h.sent();
                    _b = body, name_1 = _b.name, image = _b.image, nounId = _b.nounId, auctionUrl = _b.auctionUrl, voxelData = _b.voxelData;
                    // Validate
                    if (nounId === undefined || typeof nounId !== 'number') {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'nounId is required' }), {
                                status: 400,
                                headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                            })];
                    }
                    if (!name_1 || typeof name_1 !== 'string' || name_1.trim().length === 0) {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'Name is required' }), {
                                status: 400,
                                headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                            })];
                    }
                    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'Valid image data URL is required' }), {
                                status: 400,
                                headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                            })];
                    }
                    // Max ~3MB for the image data URL (GIFs can be larger)
                    if (image.length > 3000000) {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'Image too large (max 3MB)' }), {
                                status: 400,
                                headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                            })];
                    }
                    if (name_1.trim().length > 100) {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'Name too long (max 100 chars)' }), {
                                status: 400,
                                headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                            })];
                    }
                    // Validate auctionUrl if provided
                    if (auctionUrl && typeof auctionUrl === 'string' && auctionUrl.trim().length > 0) {
                        try {
                            new URL(auctionUrl.trim());
                        }
                        catch (_j) {
                            return [2 /*return*/, new Response(JSON.stringify({ error: 'Invalid auction URL' }), {
                                    status: 400,
                                    headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                                })];
                        }
                    }
                    if (voxelData !== undefined && typeof voxelData !== 'string') {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'voxelData must be a string when provided' }), {
                                status: 400,
                                headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                            })];
                    }
                    derivatives = [];
                    _h.label = 7;
                case 7:
                    _h.trys.push([7, 9, , 10]);
                    return [4 /*yield*/, store.get(META_KEY)];
                case 8:
                    raw = _h.sent();
                    derivatives = raw ? JSON.parse(raw) : [];
                    return [3 /*break*/, 10];
                case 9:
                    _c = _h.sent();
                    derivatives = [];
                    return [3 /*break*/, 10];
                case 10:
                    trimmedAuctionUrl = auctionUrl === null || auctionUrl === void 0 ? void 0 : auctionUrl.trim();
                    newDerivative = __assign(__assign(__assign({ id: "".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 8)), name: name_1.trim(), image: image, nounId: nounId }, (trimmedAuctionUrl && { auctionUrl: trimmedAuctionUrl })), (voxelData && { voxelData: voxelData })), { createdAt: new Date().toISOString() });
                    // Prepend (newest first)
                    derivatives.unshift(newDerivative);
                    // Save
                    return [4 /*yield*/, store.set(META_KEY, JSON.stringify(derivatives))];
                case 11:
                    // Save
                    _h.sent();
                    return [2 /*return*/, new Response(JSON.stringify(newDerivative), {
                            status: 201,
                            headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                        })];
                case 12:
                    err_1 = _h.sent();
                    return [2 /*return*/, new Response(JSON.stringify({ error: 'Failed to save derivative' }), {
                            status: 500,
                            headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                        })];
                case 13:
                    if (!(req.method === 'PATCH')) return [3 /*break*/, 19];
                    _h.label = 14;
                case 14:
                    _h.trys.push([14, 18, , 19]);
                    return [4 /*yield*/, req.json()];
                case 15:
                    body = _h.sent();
                    _d = body, id_1 = _d.id, auctionUrl = _d.auctionUrl, tokenId = _d.tokenId, tokenURI = _d.tokenURI;
                    if (!id_1 || typeof id_1 !== 'string') {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'id is required' }), {
                                status: 400,
                                headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                            })];
                    }
                    trimmedUrl = (auctionUrl === null || auctionUrl === void 0 ? void 0 : auctionUrl.trim()) || '';
                    if (trimmedUrl) {
                        try {
                            new URL(trimmedUrl);
                        }
                        catch (_k) {
                            return [2 /*return*/, new Response(JSON.stringify({ error: 'Invalid auction URL' }), {
                                    status: 400,
                                    headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                                })];
                        }
                    }
                    return [4 /*yield*/, store.get(META_KEY)];
                case 16:
                    raw = _h.sent();
                    derivatives = raw ? JSON.parse(raw) : [];
                    idx = derivatives.findIndex(function (d) { return d.id === id_1; });
                    if (idx === -1) {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'Derivative not found' }), {
                                status: 404,
                                headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                            })];
                    }
                    // Set or clear the auctionUrl
                    if (trimmedUrl) {
                        derivatives[idx].auctionUrl = trimmedUrl;
                    }
                    else if (auctionUrl !== undefined) {
                        delete derivatives[idx].auctionUrl;
                    }
                    // Set onchain tokenId if provided
                    if (tokenId !== undefined && typeof tokenId === 'number') {
                        derivatives[idx].tokenId = tokenId;
                    }
                    // Set IPFS tokenURI if provided
                    if (tokenURI && typeof tokenURI === 'string') {
                        derivatives[idx].tokenURI = tokenURI;
                    }
                    return [4 /*yield*/, store.set(META_KEY, JSON.stringify(derivatives))];
                case 17:
                    _h.sent();
                    return [2 /*return*/, new Response(JSON.stringify({ success: true }), {
                            headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                        })];
                case 18:
                    _e = _h.sent();
                    return [2 /*return*/, new Response(JSON.stringify({ error: 'Failed to update' }), {
                            status: 500,
                            headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                        })];
                case 19:
                    if (!(req.method === 'PUT')) return [3 /*break*/, 27];
                    _h.label = 20;
                case 20:
                    _h.trys.push([20, 26, , 27]);
                    return [4 /*yield*/, req.json()];
                case 21:
                    body = _h.sent();
                    id_2 = body.id;
                    if (!id_2 || typeof id_2 !== 'string') {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'id is required' }), {
                                status: 400,
                                headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                            })];
                    }
                    return [4 /*yield*/, store.get(META_KEY)];
                case 22:
                    raw = _h.sent();
                    derivatives = raw ? JSON.parse(raw) : [];
                    deriv = derivatives.find(function (d) { return d.id === id_2; });
                    if (!deriv) {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'Derivative not found' }), {
                                status: 404,
                                headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                            })];
                    }
                    // Already pinned?
                    if (deriv.tokenURI) {
                        return [2 /*return*/, new Response(JSON.stringify({ tokenURI: deriv.tokenURI }), {
                                headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                            })];
                    }
                    base64Match = deriv.image.match(/^data:image\/(\w+);base64,(.+)$/);
                    if (!base64Match) {
                        return [2 /*return*/, new Response(JSON.stringify({ error: 'Invalid image format' }), {
                                status: 400,
                                headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                            })];
                    }
                    ext = base64Match[1], b64 = base64Match[2];
                    imageBytes = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
                    return [4 /*yield*/, pinToIPFS(imageBytes, "derivative-".concat(id_2, ".").concat(ext))];
                case 23:
                    imageHash = _h.sent();
                    metadata = {
                        name: deriv.name,
                        description: "Derivative of Noun #".concat((_f = deriv.nounId) !== null && _f !== void 0 ? _f : 'unknown'),
                        image: "ipfs://".concat(imageHash),
                        attributes: [
                            { trait_type: 'Noun ID', value: (_g = deriv.nounId) !== null && _g !== void 0 ? _g : 0 },
                            { trait_type: 'Creator', value: deriv.name },
                        ],
                    };
                    return [4 /*yield*/, pinToIPFS(JSON.stringify(metadata), "metadata-".concat(id_2, ".json"), true)];
                case 24:
                    metadataHash = _h.sent();
                    tokenURI = "ipfs://".concat(metadataHash);
                    idx = derivatives.findIndex(function (d) { return d.id === id_2; });
                    derivatives[idx].tokenURI = tokenURI;
                    return [4 /*yield*/, store.set(META_KEY, JSON.stringify(derivatives))];
                case 25:
                    _h.sent();
                    return [2 /*return*/, new Response(JSON.stringify({ tokenURI: tokenURI, imageHash: imageHash, metadataHash: metadataHash }), {
                            headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                        })];
                case 26:
                    err_2 = _h.sent();
                    msg = err_2 instanceof Error ? err_2.message : 'Pin failed';
                    return [2 /*return*/, new Response(JSON.stringify({ error: msg }), {
                            status: 500,
                            headers: __assign({ 'Content-Type': 'application/json' }, corsHeaders),
                        })];
                case 27: return [2 /*return*/, new Response('Method not allowed', { status: 405, headers: corsHeaders })];
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
