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
exports.nounsRequiredToPropose = exports.minProposalDurationDays = exports.gracePeriodDurationDays = exports.queuedPeriodDurationDays = exports.activePeriodDurationDays = exports.pendingPeriodDurationDays = exports.updatablePeriodDurationDays = exports.quorumIncreasePerAgainstVote = exports.maxQuorumAgainstVotes = exports.adjustedTotalSupply = exports.dynamicQuorumParams = exports.maxQuorumVotes = exports.minQuorumVotes = void 0;
var governor_1 = require("@nouns/sdk/governor");
var treasury_1 = require("@nouns/sdk/treasury");
var core_1 = require("@wagmi/core");
var config_1 = require("@/config");
var minQuorumVotes = function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        return [2 /*return*/, (0, governor_1.readNounsGovernorMinQuorumVotes)(config_1.wagmiConfig, {})];
    });
}); };
exports.minQuorumVotes = minQuorumVotes;
var maxQuorumVotes = function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        return [2 /*return*/, (0, governor_1.readNounsGovernorMaxQuorumVotes)(config_1.wagmiConfig, {})];
    });
}); };
exports.maxQuorumVotes = maxQuorumVotes;
var dynamicQuorumParams = function () { return __awaiter(void 0, void 0, void 0, function () {
    var currentBlockNumber;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, core_1.getBlockNumber)(config_1.wagmiConfig)];
            case 1:
                currentBlockNumber = _a.sent();
                return [2 /*return*/, (0, governor_1.readNounsGovernorGetDynamicQuorumParamsAt)(config_1.wagmiConfig, {
                        args: [currentBlockNumber],
                    })];
        }
    });
}); };
exports.dynamicQuorumParams = dynamicQuorumParams;
var adjustedTotalSupply = function () { return __awaiter(void 0, void 0, void 0, function () { return __generator(this, function (_a) {
    switch (_a.label) {
        case 0: return [4 /*yield*/, (0, governor_1.readNounsGovernorAdjustedTotalSupply)(config_1.wagmiConfig, {})];
        case 1: return [2 /*return*/, _a.sent()];
    }
}); }); };
exports.adjustedTotalSupply = adjustedTotalSupply;
var maxQuorumAgainstVotes = function () { return __awaiter(void 0, void 0, void 0, function () {
    var _a, maxQuorumVotesBPS, minQuorumVotesBPS, quorumCoefficient, _b, _c, _d, _e;
    return __generator(this, function (_f) {
        switch (_f.label) {
            case 0: return [4 /*yield*/, (0, exports.dynamicQuorumParams)()];
            case 1:
                _a = _f.sent(), maxQuorumVotesBPS = _a.maxQuorumVotesBPS, minQuorumVotesBPS = _a.minQuorumVotesBPS, quorumCoefficient = _a.quorumCoefficient;
                _c = (_b = Math).ceil;
                _d = 100;
                _e = Number;
                return [4 /*yield*/, (0, exports.adjustedTotalSupply)()];
            case 2: return [2 /*return*/, _c.apply(_b, [(_d * _e.apply(void 0, [_f.sent()]) * (maxQuorumVotesBPS - minQuorumVotesBPS)) /
                        quorumCoefficient])];
        }
    });
}); };
exports.maxQuorumAgainstVotes = maxQuorumAgainstVotes;
var quorumIncreasePerAgainstVote = function () { return __awaiter(void 0, void 0, void 0, function () {
    var _a, _b, _c;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0:
                _a = Number;
                return [4 /*yield*/, (0, exports.maxQuorumVotes)()];
            case 1:
                _b = (_d.sent());
                return [4 /*yield*/, (0, exports.minQuorumVotes)()];
            case 2:
                _c = _a.apply(void 0, [_b - (_d.sent())]);
                return [4 /*yield*/, (0, exports.maxQuorumAgainstVotes)()];
            case 3: return [2 /*return*/, (_c / (_d.sent())).toFixed(2)];
        }
    });
}); };
exports.quorumIncreasePerAgainstVote = quorumIncreasePerAgainstVote;
var secondsInADay = 86400;
var updatablePeriodDurationDays = function () { return __awaiter(void 0, void 0, void 0, function () {
    var updatablePeriodInBlocks;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, governor_1.readNounsGovernorProposalUpdatablePeriodInBlocks)(config_1.wagmiConfig, {})];
            case 1:
                updatablePeriodInBlocks = _a.sent();
                return [2 /*return*/, (Number(updatablePeriodInBlocks) * config_1.default.mainnetBlockDurationSeconds) / secondsInADay];
        }
    });
}); };
exports.updatablePeriodDurationDays = updatablePeriodDurationDays;
var pendingPeriodDurationDays = function () { return __awaiter(void 0, void 0, void 0, function () {
    var pendingPeriodInBlocks;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, governor_1.readNounsGovernorVotingDelay)(config_1.wagmiConfig, {})];
            case 1:
                pendingPeriodInBlocks = _a.sent();
                return [2 /*return*/, (Number(pendingPeriodInBlocks) * config_1.default.mainnetBlockDurationSeconds) / secondsInADay];
        }
    });
}); };
exports.pendingPeriodDurationDays = pendingPeriodDurationDays;
var activePeriodDurationDays = function () { return __awaiter(void 0, void 0, void 0, function () {
    var activePeriodInBlocks;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, governor_1.readNounsGovernorVotingPeriod)(config_1.wagmiConfig, {})];
            case 1:
                activePeriodInBlocks = _a.sent();
                return [2 /*return*/, (Number(activePeriodInBlocks) * config_1.default.mainnetBlockDurationSeconds) / secondsInADay];
        }
    });
}); };
exports.activePeriodDurationDays = activePeriodDurationDays;
var queuedPeriodDurationDays = function () { return __awaiter(void 0, void 0, void 0, function () {
    var queuedPeriodInSeconds;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, treasury_1.readNounsTreasuryDelay)(config_1.wagmiConfig, {})];
            case 1:
                queuedPeriodInSeconds = _a.sent();
                return [2 /*return*/, Number(queuedPeriodInSeconds) / secondsInADay];
        }
    });
}); };
exports.queuedPeriodDurationDays = queuedPeriodDurationDays;
var gracePeriodDurationDays = function () { return __awaiter(void 0, void 0, void 0, function () {
    var gracePeriodInSeconds;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, treasury_1.readNounsTreasuryGracePeriod)(config_1.wagmiConfig, {})];
            case 1:
                gracePeriodInSeconds = _a.sent();
                return [2 /*return*/, Number(gracePeriodInSeconds) / secondsInADay];
        }
    });
}); };
exports.gracePeriodDurationDays = gracePeriodDurationDays;
var minProposalDurationDays = function () { return __awaiter(void 0, void 0, void 0, function () {
    var _a, _b, _c;
    return __generator(this, function (_d) {
        switch (_d.label) {
            case 0: return [4 /*yield*/, (0, exports.updatablePeriodDurationDays)()];
            case 1:
                _a = (_d.sent());
                return [4 /*yield*/, (0, exports.pendingPeriodDurationDays)()];
            case 2:
                _b = _a +
                    (_d.sent());
                return [4 /*yield*/, (0, exports.activePeriodDurationDays)()];
            case 3:
                _c = _b +
                    (_d.sent());
                return [4 /*yield*/, (0, exports.queuedPeriodDurationDays)()];
            case 4: return [2 /*return*/, (_c +
                    (_d.sent()))];
        }
    });
}); };
exports.minProposalDurationDays = minProposalDurationDays;
var nounsRequiredToPropose = function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, governor_1.readNounsGovernorProposalThreshold)(config_1.wagmiConfig, {})];
            case 1: return [2 /*return*/, (_a.sent()) + 1n];
        }
    });
}); };
exports.nounsRequiredToPropose = nounsRequiredToPropose;
