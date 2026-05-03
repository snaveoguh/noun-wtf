"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.wagmiConfig = void 0;
var core_1 = require("@wagmi/core");
var chains_1 = require("@wagmi/core/chains");
exports.default = {
    baseUri: process.env.NEXT_PUBLIC_BASE_URI,
    mainnetBlockDurationSeconds: 12,
};
exports.wagmiConfig = (0, core_1.createConfig)({
    chains: [chains_1.mainnet],
    transports: (_a = {},
        _a[chains_1.mainnet.id] = (0, core_1.http)(process.env.JSON_RPC),
        _a),
});
