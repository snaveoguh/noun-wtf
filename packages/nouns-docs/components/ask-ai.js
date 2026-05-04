'use client';
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
exports.AskAI = void 0;
var react_1 = require("react");
var react_2 = require("@headlessui/react");
var lucide_react_1 = require("lucide-react");
var navigation_1 = require("next/navigation");
var components_1 = require("nextra/components");
var config_1 = require("@/config");
var claude_svg_react_1 = require("@/public/images/ai/claude.svg?react");
var openai_svg_react_1 = require("@/public/images/ai/openai.svg?react");
var AskAI = function (_a) {
    var markdownUri = _a.markdownUri;
    var _b = (0, react_1.useState)(false), copied = _b[0], setCopied = _b[1];
    var pathname = (0, navigation_1.usePathname)();
    var plaintextUri = markdownUri !== null && markdownUri !== void 0 ? markdownUri : "".concat(config_1.default.baseUri).concat(pathname, ".txt");
    var handleCopyPageContent = (0, react_1.useCallback)(function () { return __awaiter(void 0, void 0, void 0, function () {
        var txtUrl, response, content, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 4, , 5]);
                    txtUrl = plaintextUri !== null && plaintextUri !== void 0 ? plaintextUri : "".concat(window.location.pathname, ".txt");
                    return [4 /*yield*/, fetch(txtUrl)];
                case 1:
                    response = _a.sent();
                    if (!response.ok) {
                        console.error("Failed to fetch content from ".concat(txtUrl, ": ").concat(response.status));
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, response.text()];
                case 2:
                    content = _a.sent();
                    return [4 /*yield*/, navigator.clipboard.writeText(content)];
                case 3:
                    _a.sent();
                    setCopied(true);
                    setTimeout(function () { return setCopied(false); }, 1000);
                    return [3 /*break*/, 5];
                case 4:
                    error_1 = _a.sent();
                    console.error('Failed to copy page content:', error_1);
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    }); }, [pathname, plaintextUri]);
    return (<div className="flex">
      <a href={"https://chatgpt.com/?q=".concat(encodeURIComponent("Please research and analyze this page: ".concat(plaintextUri, " so I can ask you questions about it. Once you have read it, prompt me with any questions I have. Do not post content from the page in your response. Any of my follow up questions must be answered by referencing the site I provided (including other pages from the same website).")))} target="_blank" rel="noopener" className={'border-border flex items-center justify-center gap-1.5 rounded-l-full border px-2 text-xs !no-underline'}>
        <openai_svg_react_1.default className="-m-1 size-6 align-middle"/>{' '}
        <span className="xs:inline-block hidden">Ask ChatGPT</span>
      </a>
      <react_2.Menu>
        <react_2.MenuButton as={components_1.Button} variant="outline" className="h-full !rounded-r-full !border-l-0 !pr-2">
          {copied ? (<lucide_react_1.ClipboardCheckIcon className="h-4 w-4"/>) : (<lucide_react_1.ChevronDownIcon className="h-4 w-4"/>)}
        </react_2.MenuButton>
        <react_2.MenuItems anchor="bottom" className="border-border divide-divide x:bg-nextra-bg z-30 mt-1 divide-y rounded-sm border shadow">
          <react_2.MenuItem as="a" target="_blank" rel="noopener" href={"https://claude.ai/new?q=".concat(encodeURIComponent("Please use this page to answer my questions: ".concat(plaintextUri, ". You must read it before you answer me.\n\n")))} className="data-focus:bg-blue-100 flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
            <claude_svg_react_1.default className="h-4 w-4"/>
            Ask Claude
          </react_2.MenuItem>
          <react_2.MenuItem as={'button'} className="data-focus:bg-blue-100 flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={handleCopyPageContent}>
            <lucide_react_1.CopyIcon className="h-4 w-4"/>
            Copy page for LLMs
          </react_2.MenuItem>
        </react_2.MenuItems>
      </react_2.Menu>
    </div>);
};
exports.AskAI = AskAI;
