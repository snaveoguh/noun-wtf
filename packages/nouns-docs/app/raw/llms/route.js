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
exports.GET = GET;
var server_1 = require("next/server");
var page_map_1 = require("nextra/page-map");
var config_1 = require("@/config");
function generateMarkdownFromPageMap(pageMap, baseUrl) {
    var _a, _b, _c, _d;
    if (baseUrl === void 0) { baseUrl = ''; }
    var markdown = '';
    for (var _i = 0, pageMap_1 = pageMap; _i < pageMap_1.length; _i++) {
        var item = pageMap_1[_i];
        var title = item.title || ((_a = item.frontMatter) === null || _a === void 0 ? void 0 : _a.title);
        if (!title)
            continue;
        // If item has children, treat it as a section
        if (item.children && item.children.length > 0) {
            markdown += "## ".concat(title, "\n\n");
            // Add pages as list items
            for (var _e = 0, _f = item.children; _e < _f.length; _e++) {
                var child = _f[_e];
                var childTitle = child.title || ((_b = child.frontMatter) === null || _b === void 0 ? void 0 : _b.title);
                var childDescription = child.description || ((_c = child.frontMatter) === null || _c === void 0 ? void 0 : _c.description);
                if (!childTitle)
                    continue;
                var route = child.route || '';
                var fullUrl = "".concat(baseUrl).concat(route);
                if (childDescription) {
                    markdown += "- [".concat(childTitle, "](").concat(fullUrl, "): ").concat(childDescription, "\n");
                }
                else {
                    markdown += "- [".concat(childTitle, "](").concat(fullUrl, ")\n");
                }
            }
            markdown += '\n';
        }
        else if (item.route) {
            // If it's a standalone page, add it as a list item under a general section
            var description = item.description || ((_d = item.frontMatter) === null || _d === void 0 ? void 0 : _d.description);
            var fullUrl = "".concat(baseUrl).concat(item.route);
            if (description) {
                markdown += "- [".concat(title, "](").concat(fullUrl, "): ").concat(description, "\n");
            }
            else {
                markdown += "- [".concat(title, "](").concat(fullUrl, ")\n");
            }
            // Add newline after standalone pages to separate from following sections
            markdown += '\n';
        }
    }
    return markdown;
}
function GET() {
    return __awaiter(this, void 0, void 0, function () {
        var pageMap, baseUrl, markdown, content, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, page_map_1.getPageMap)()];
                case 1:
                    pageMap = (_a.sent()).filter(function (p) { return !(p === null || p === void 0 ? void 0 : p.route) || p.route !== '/'; });
                    baseUrl = config_1.default.baseUri;
                    markdown = generateMarkdownFromPageMap(pageMap, baseUrl);
                    content = "# Nouns DAO Documentation\n\nNouns DAO is a Decentralized Autonomous Organization (DAO) empowering Nouns NFT owners to shape and govern the project by voting on proposals funded by the Treasury. Nouns NFTs are auctioned daily, and the proceeds go to the Nouns Treasury.\n\n".concat(markdown);
                    return [2 /*return*/, new server_1.NextResponse(content, {
                            headers: {
                                'Content-Type': 'text/plain; charset=utf-8',
                                'Cache-Control': 'public, max-age=3600',
                            },
                        })];
                case 2:
                    error_1 = _a.sent();
                    console.error('Error generating llms.txt:', error_1);
                    return [2 /*return*/, new server_1.NextResponse('Error generating documentation', {
                            status: 500,
                            headers: {
                                'Content-Type': 'text/plain; charset=utf-8',
                            },
                        })];
                case 3: return [2 /*return*/];
            }
        });
    });
}
