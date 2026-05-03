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
exports.metadata = void 0;
exports.default = RootLayout;
var components_1 = require("nextra/components");
var page_map_1 = require("nextra/page-map");
var nextra_theme_docs_1 = require("nextra-theme-docs");
require("nextra-theme-docs/style.css");
var ask_ai_1 = require("@/components/ask-ai");
var config_1 = require("@/config");
var logo_svg_react_1 = require("@/public/images/general/logo.svg?react");
var discord_svg_react_1 = require("@/public/images/socials/discord.svg?react");
var farcaster_svg_react_1 = require("@/public/images/socials/farcaster.svg?react");
var github_svg_react_1 = require("@/public/images/socials/github.svg?react");
var x_svg_react_1 = require("@/public/images/socials/x.svg?react");
require("../globals.css");
exports.metadata = {
    title: 'Nouns DAO Docs',
    description: 'Documentation for Nouns DAO',
};
var llmsTxtUri = config_1.default.baseUri + '/llms.txt';
var navbar = (<nextra_theme_docs_1.Navbar logo={<span className="xs:text-4xl shrink whitespace-nowrap text-3xl font-bold">
        <logo_svg_react_1.default className="inline-block w-auto max-w-[100px] align-top"/> Docs
      </span>}>
    <ask_ai_1.AskAI markdownUri={llmsTxtUri}/>
  </nextra_theme_docs_1.Navbar>);
var footer = (<nextra_theme_docs_1.Footer>
    <div className="flex w-full flex-wrap items-center justify-between gap-10">
      <span>
        {new Date().getFullYear()} Nouns DAO · made with{' '}
        <img src={'/images/general/logo.svg'} style={{ height: '12px', display: 'inline-block' }}/>
      </span>
      <div className="flex gap-6">
        <a href="https://x.com/nounsdao" target="_blank" rel="noopener">
          <x_svg_react_1.default className="size-5 p-0.5"/>
        </a>
        <a href="https://farcaster.xyz/~/channel/nouns" target="_blank" rel="noopener">
          <farcaster_svg_react_1.default className="size-5"/>
        </a>
        <a href="https://github.com/nounsDAO" target="_blank" rel="noopener">
          <github_svg_react_1.default className="size-5"/>
        </a>
        <a href="https://discord.gg/Z47Qpz26Fe" target="_blank" rel="noopener">
          <discord_svg_react_1.default className="size-5"/>
        </a>
      </div>
    </div>
  </nextra_theme_docs_1.Footer>);
function RootLayout(_a) {
    return __awaiter(this, arguments, void 0, function (_b) {
        var children = _b.children;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0: return [4 /*yield*/, (0, page_map_1.getPageMap)()];
                case 1: return [2 /*return*/, (<html 
                    // Not required, but good for SEO
                    lang="en" 
                    // Required to be set
                    dir="ltr" 
                    // Suggested by `next-themes` package https://github.com/pacocoursey/next-themes#with-app
                    suppressHydrationWarning>
      <components_1.Head color={{
                            hue: { dark: 347, light: 347 },
                            saturation: { dark: 65, light: 95 },
                            lightness: { dark: 54, light: 54 },
                        }}>
        <link rel="shortcut icon" href="/images/general/docs-head.svg"/>
        {/* Your additional tags should be passed as `children` of `<Head>` element */}
      </components_1.Head>
      <body>
        <nextra_theme_docs_1.Layout navbar={navbar} pageMap={_c.sent()} docsRepositoryBase="https://github.com/nounsDAO/nouns-monorepo/edit/master/packages/nouns-docs/" footer={footer} toc={{
                            extraContent: <ask_ai_1.AskAI />,
                        }}>
          {children}
        </nextra_theme_docs_1.Layout>
      </body>
    </html>)];
            }
        });
    });
}
