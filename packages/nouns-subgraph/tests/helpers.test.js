"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graph_ts_1 = require("@graphprotocol/graph-ts");
const index_1 = require("matchstick-as/assembly/index");
const schema_1 = require("../src/types/schema");
const constants_1 = require("../src/utils/constants");
const helpers_1 = require("../src/utils/helpers");
(0, index_1.describe)('getOrCreateDynamicQuorumParams', () => {
    (0, index_1.afterEach)(() => {
        (0, index_1.clearStore)();
    });
    (0, index_1.test)('sets dynamicQuorumStartBlock to null', () => {
        const params = (0, helpers_1.getOrCreateDynamicQuorumParams)();
        index_1.assert.assertTrue(params.dynamicQuorumStartBlock === null);
    });
    (0, index_1.test)('sets dynamicQuorumStartBlock to input block number', () => {
        const params = (0, helpers_1.getOrCreateDynamicQuorumParams)(constants_1.BIGINT_10K);
        index_1.assert.bigIntEquals(constants_1.BIGINT_10K, params.dynamicQuorumStartBlock);
    });
    (0, index_1.test)('sets dynamicQuorumStartBlock first number after first being null, and later attempt to set to a different number', () => {
        let params = (0, helpers_1.getOrCreateDynamicQuorumParams)();
        index_1.assert.assertTrue(params.dynamicQuorumStartBlock === null);
        params = (0, helpers_1.getOrCreateDynamicQuorumParams)(constants_1.BIGINT_ONE);
        index_1.assert.bigIntEquals(constants_1.BIGINT_ONE, params.dynamicQuorumStartBlock);
        params = (0, helpers_1.getOrCreateDynamicQuorumParams)(constants_1.BIGINT_10K);
        index_1.assert.bigIntEquals(constants_1.BIGINT_ONE, params.dynamicQuorumStartBlock);
    });
    (0, index_1.test)('calcEncodedProposalHash', () => {
        const proposal = new schema_1.Proposal('1');
        proposal.description = 'some description';
        proposal.proposer = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB';
        proposal.targets = [graph_ts_1.Bytes.fromHexString('0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa')];
        proposal.values = [graph_ts_1.BigInt.fromU32(300)];
        proposal.signatures = ['some signature'];
        proposal.calldatas = [graph_ts_1.Bytes.fromUTF8('some data')];
        const hash = (0, helpers_1.calcEncodedProposalHash)(proposal, false);
        index_1.assert.bytesEquals(graph_ts_1.Bytes.fromHexString('0xcf95b7d08d761ff0bf1223220f45b79baffbce6c8bcceb8df5399cbc6d22c40d'), hash);
        proposal.targets = [
            graph_ts_1.Bytes.fromHexString('0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'),
            graph_ts_1.Bytes.fromHexString('0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'),
        ];
        proposal.values = [graph_ts_1.BigInt.fromU32(300), graph_ts_1.BigInt.fromU32(500)];
        proposal.signatures = ['some signature', 'hello()'];
        proposal.calldatas = [graph_ts_1.Bytes.fromUTF8('some data'), graph_ts_1.Bytes.fromHexString('0xaabbccdd')];
        const hash2 = (0, helpers_1.calcEncodedProposalHash)(proposal, false);
        index_1.assert.bytesEquals(graph_ts_1.Bytes.fromHexString('0x5d6f3b870407fff8109c6c9469173eef879d0d2eaf3de0fb5770b7f48f760101'), hash2);
        const hash3 = (0, helpers_1.calcEncodedProposalHash)(proposal, true);
        index_1.assert.bytesEquals(graph_ts_1.Bytes.fromHexString('0xdc10157349778884412d140419c22ab67aa7a84a4f23dead50533a9aca0fbb28'), hash3);
    });
});
