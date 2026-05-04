"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graph_ts_1 = require("@graphprotocol/graph-ts");
const index_1 = require("matchstick-as/assembly/index");
const constants_1 = require("../src/utils/constants");
const dynamicQuorum_1 = require("../src/utils/dynamicQuorum");
(0, index_1.describe)('dynamicQuorumVotes', () => {
    (0, index_1.test)('coefficient set to zero', () => {
        const quorum = (0, dynamicQuorum_1.dynamicQuorumVotes)(graph_ts_1.BigInt.fromI32(12), graph_ts_1.BigInt.fromI32(200), 1000, 4000, constants_1.BIGINT_ZERO);
        index_1.assert.bigIntEquals(graph_ts_1.BigInt.fromI32(20), quorum);
    });
    (0, index_1.test)('increases linearly', () => {
        const quorum = (0, dynamicQuorum_1.dynamicQuorumVotes)(graph_ts_1.BigInt.fromI32(18), graph_ts_1.BigInt.fromI32(200), 1000, 4000, graph_ts_1.BigInt.fromI32(1000000));
        index_1.assert.bigIntEquals(graph_ts_1.BigInt.fromI32(38), quorum);
    });
    (0, index_1.test)('capped at max', () => {
        index_1.assert.bigIntEquals(graph_ts_1.BigInt.fromI32(200), (0, dynamicQuorum_1.dynamicQuorumVotes)(graph_ts_1.BigInt.fromI32(60), graph_ts_1.BigInt.fromI32(200), 1000, 10000, graph_ts_1.BigInt.fromI32(3000000)));
        index_1.assert.bigIntEquals(graph_ts_1.BigInt.fromI32(80), (0, dynamicQuorum_1.dynamicQuorumVotes)(graph_ts_1.BigInt.fromI32(30), graph_ts_1.BigInt.fromI32(200), 1000, 4000, graph_ts_1.BigInt.fromI32(2000000)));
    });
});
