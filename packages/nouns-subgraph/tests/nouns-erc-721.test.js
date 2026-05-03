"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graph_ts_1 = require("@graphprotocol/graph-ts");
const index_1 = require("matchstick-as/assembly/index");
const nouns_erc_721_1 = require("../src/nouns-erc-721");
const constants_1 = require("../src/utils/constants");
const helpers_1 = require("../src/utils/helpers");
const utils_1 = require("./utils");
const someAddress = graph_ts_1.Address.fromString('0x0000000000000000000000000000000000000001');
const freshHolderAddress = graph_ts_1.Address.fromString('0x0000000000000000000000000000000000000002');
const popularDelegate = graph_ts_1.Address.fromString('0x0000000000000000000000000000000000000003');
const BLACKHOLE_ADDRESS = graph_ts_1.Address.fromString('0x0000000000000000000000000000000000000000');
const txHash = graph_ts_1.Bytes.fromI32(11);
const logIndex = graph_ts_1.BigInt.fromI32(3);
const updateBlockTimestamp = graph_ts_1.BigInt.fromI32(946684800);
const updateBlockNumber = graph_ts_1.BigInt.fromI32(15537394);
(0, index_1.afterEach)(() => {
    (0, index_1.clearStore)();
});
(0, index_1.describe)('nouns-erc-721', () => {
    (0, index_1.describe)('Delegate changes', () => {
        (0, index_1.beforeEach)(() => {
            const delegate = (0, helpers_1.getOrCreateDelegate)(someAddress.toHexString());
            delegate.tokenHoldersRepresentedAmount = 1;
            delegate.delegatedVotes = constants_1.BIGINT_ONE;
            delegate.delegatedVotesRaw = constants_1.BIGINT_ONE;
            delegate.save();
            const account = (0, helpers_1.getOrCreateAccount)(someAddress.toHexString());
            account.tokenBalance = constants_1.BIGINT_ONE;
            account.tokenBalanceRaw = constants_1.BIGINT_ONE;
            account.nouns = ['1'];
            account.save();
        });
        (0, index_1.afterAll)(() => {
            (0, index_1.clearStore)();
        });
        (0, index_1.test)('after having delegated votes, transferring all nouns avoids nulling account delegate', () => {
            const delegateChangeEvent = (0, utils_1.createDelegateChangedEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, someAddress, someAddress, popularDelegate);
            (0, nouns_erc_721_1.handleDelegateChanged)(delegateChangeEvent);
            index_1.assert.fieldEquals('Account', someAddress.toHexString(), 'delegate', popularDelegate.toHexString());
            index_1.assert.fieldEquals('Delegate', popularDelegate.toHexString(), 'nounsRepresented', '[1]');
            const randomDelegateIncreateVoteEvent = (0, utils_1.createDelegateVotesChangedEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, popularDelegate, constants_1.BIGINT_ZERO, constants_1.BIGINT_ONE);
            const accountDelegateDecreaseVoteEvent = (0, utils_1.createDelegateVotesChangedEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, someAddress, constants_1.BIGINT_ONE, constants_1.BIGINT_ZERO);
            (0, nouns_erc_721_1.handleDelegateVotesChanged)(randomDelegateIncreateVoteEvent);
            (0, nouns_erc_721_1.handleDelegateVotesChanged)(accountDelegateDecreaseVoteEvent);
            index_1.assert.fieldEquals('Delegate', popularDelegate.toHexString(), 'delegatedVotes', '1');
            index_1.assert.fieldEquals('Delegate', someAddress.toHexString(), 'delegatedVotes', '0');
            const transferEvent = (0, utils_1.createTransferEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, someAddress, BLACKHOLE_ADDRESS, constants_1.BIGINT_ONE);
            const randomDelegateDecreateVoteEvent = (0, utils_1.createDelegateVotesChangedEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, popularDelegate, constants_1.BIGINT_ONE, constants_1.BIGINT_ZERO);
            (0, nouns_erc_721_1.handleTransfer)(transferEvent);
            (0, nouns_erc_721_1.handleDelegateVotesChanged)(randomDelegateDecreateVoteEvent);
            index_1.assert.fieldEquals('Account', someAddress.toHexString(), 'tokenBalance', '0');
            index_1.assert.fieldEquals('Account', someAddress.toHexString(), 'delegate', popularDelegate.toHexString());
            index_1.assert.fieldEquals('Delegate', popularDelegate.toHexString(), 'nounsRepresented', '[]');
            index_1.assert.fieldEquals('Delegate', popularDelegate.toHexString(), 'delegatedVotes', '0');
        });
        (0, index_1.test)('transfer events from account with delegation ignore delegate changes', () => {
            const delegateChangeEvent = (0, utils_1.createDelegateChangedEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, someAddress, someAddress, popularDelegate);
            (0, nouns_erc_721_1.handleDelegateChanged)(delegateChangeEvent);
            index_1.assert.fieldEquals('Account', someAddress.toHexString(), 'delegate', popularDelegate.toHexString());
            const selloutEvent = (0, utils_1.createTransferEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, someAddress, BLACKHOLE_ADDRESS, constants_1.BIGINT_ONE);
            (0, nouns_erc_721_1.handleTransfer)(selloutEvent);
            index_1.assert.fieldEquals('Account', someAddress.toHexString(), 'delegate', popularDelegate.toHexString());
            const buybackEvent = (0, utils_1.createTransferEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, BLACKHOLE_ADDRESS, someAddress, constants_1.BIGINT_ONE);
            (0, nouns_erc_721_1.handleTransfer)(buybackEvent);
            index_1.assert.fieldEquals('Account', someAddress.toHexString(), 'delegate', popularDelegate.toHexString());
        });
        (0, index_1.test)('fresh new token holder self-delegates by default', () => {
            const account = (0, helpers_1.getOrCreateAccount)(freshHolderAddress.toHexString());
            account.save();
            const buyNounEvent = (0, utils_1.createTransferEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, BLACKHOLE_ADDRESS, freshHolderAddress, constants_1.BIGINT_ONE);
            (0, nouns_erc_721_1.handleTransfer)(buyNounEvent);
            index_1.assert.fieldEquals('Account', freshHolderAddress.toHexString(), 'tokenBalance', '1');
            index_1.assert.fieldEquals('Account', freshHolderAddress.toHexString(), 'delegate', freshHolderAddress.toHexString());
        });
    });
});
