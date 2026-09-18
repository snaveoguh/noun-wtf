// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.19;

import 'forge-std/Test.sol';
import { DeployUtils } from './DeployUtils.sol';
import { INounsDAOLogic } from '../../../contracts/interfaces/INounsDAOLogic.sol';
import { NounsDAOLogicV4 } from '../../../contracts/governance/NounsDAOLogicV4.sol';
import { NounsDAOProxyV3 } from '../../../contracts/governance/NounsDAOProxyV3.sol';
import { NounsDAOForkEscrow } from '../../../contracts/governance/fork/NounsDAOForkEscrow.sol';
import { NounsDAOExecutorV2 } from '../../../contracts/governance/NounsDAOExecutorV2.sol';
import { ERC1967Proxy } from '@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol';
import { NounsAuctionHouseV3 } from '../../../contracts/NounsAuctionHouseV3.sol';
import { NounsAuctionHouseProxy } from '../../../contracts/proxies/NounsAuctionHouseProxy.sol';
import { NounsAuctionHouseProxyAdmin } from '../../../contracts/proxies/NounsAuctionHouseProxyAdmin.sol';
import { NounsToken } from '../../../contracts/NounsToken.sol';
import { NounsSeeder } from '../../../contracts/NounsSeeder.sol';
import { NounsDescriptorV2 } from '../../../contracts/NounsDescriptorV2.sol';
import { ProxyRegistryMock } from './ProxyRegistryMock.sol';
import { ForkDAODeployer } from '../../../contracts/governance/fork/ForkDAODeployer.sol';
import { NounsTokenFork } from '../../../contracts/governance/fork/newdao/token/NounsTokenFork.sol';
import { NounsAuctionHouseFork } from '../../../contracts/governance/fork/newdao/NounsAuctionHouseFork.sol';
import { NounsDAOLogicV1Fork } from '../../../contracts/governance/fork/newdao/governance/NounsDAOLogicV1Fork.sol';
import { NounsDAOTypes } from '../../../contracts/governance/NounsDAOInterfaces.sol';
import { INounsDAOLogic } from '../../../contracts/interfaces/INounsDAOLogic.sol';
import { INounsToken } from '../../../contracts/interfaces/INounsToken.sol';
import { WETH } from '../../../contracts/test/WETH.sol';
import { ChainalysisSanctionsListMock } from './ChainalysisSanctionsListMock.sol';

abstract contract DeployUtilsV3 is DeployUtils {
    NounsAuctionHouseProxyAdmin auctionHouseProxyAdmin;

    function _createDAOV3Proxy(
        address timelock,
        address nounsToken,
        address vetoer,
        NounsDAOTypes.NounsDAOParams memory daoParams,
        NounsDAOTypes.DynamicQuorumParams memory dqParams
    ) internal returns (INounsDAOLogic dao) {
        uint256 nonce = vm.getNonce(address(this));
        address predictedForkEscrowAddress = computeCreateAddress(address(this), nonce + 2);
        dao = INounsDAOLogic(
            address(
                new NounsDAOProxyV3(
                    timelock,
                    nounsToken,
                    predictedForkEscrowAddress,
                    address(0),
                    vetoer,
                    timelock,
                    address(new NounsDAOLogicV4()),
                    daoParams,
                    dqParams
                )
            )
        );
        address(new NounsDAOForkEscrow(address(dao), address(nounsToken)));
    }

    function _createDAOV3Proxy(
        address timelock,
        address nounsToken,
        address vetoer
    ) internal returns (INounsDAOLogic dao) {
        dao = _createDAOV3Proxy(
            timelock,
            nounsToken,
            vetoer,
            NounsDAOTypes.NounsDAOParams({
                votingPeriod: VOTING_PERIOD,
                votingDelay: VOTING_DELAY,
                proposalThresholdBPS: PROPOSAL_THRESHOLD,
                lastMinuteWindowInBlocks: LAST_MINUTE_BLOCKS,
                objectionPeriodDurationInBlocks: OBJECTION_PERIOD_BLOCKS,
                proposalUpdatablePeriodInBlocks: 0
            }),
            NounsDAOTypes.DynamicQuorumParams({
                minQuorumVotesBPS: 200,
                maxQuorumVotesBPS: 2000,
                quorumCoefficient: 10000
            })
        );
    }

    struct Temp {
        NounsDAOExecutorV2 timelock;
        NounsToken nounsToken;
        address weth;
        NounsDescriptorV2 descriptor;
        NounsSeeder seeder;
        ProxyRegistryMock proxyRegistry;
    }

    function _deployDAOV3WithParams(uint256 auctionDuration) internal returns (INounsDAOLogic) {
        Temp memory t;
        t.timelock = NounsDAOExecutorV2(payable(address(new ERC1967Proxy(address(new NounsDAOExecutorV2()), ''))));
        t.timelock.initialize(address(1), TIMELOCK_DELAY);

        auctionHouseProxyAdmin = new NounsAuctionHouseProxyAdmin();

        // Everything the token depends on is deployed first, and nothing but the three `new` expressions
        // happens between the nonce read below and the token. With forge's dynamic test linking (the default
        // since 1.8) every external CALL this contract makes advances its nonce, not only CREATEs, so a
        // prediction taken across the descriptor's setter calls -- the old `nonce + 9` -- landed well short and
        // failed every setUp with 'Token address mismatch'. Keeping the window call-free makes the prediction
        // hold whether linking is on or off.
        t.weth = address(new WETH());
        t.descriptor = _deployAndPopulateV2();
        t.seeder = new NounsSeeder();
        t.proxyRegistry = new ProxyRegistryMock();

        // The auction house takes the token address as an immutable and the token takes the auction house as
        // its minter, so one side has to be predicted: +0 auction house impl, +1 its proxy, +2 the token.
        address predictedTokenAddress = computeCreateAddress(address(this), vm.getNonce(address(this)) + 2);
        NounsAuctionHouseV3 auctionHouseImpl = new NounsAuctionHouseV3(
            INounsToken(predictedTokenAddress),
            t.weth,
            auctionDuration
        );
        NounsAuctionHouseProxy auctionProxy = new NounsAuctionHouseProxy(
            address(auctionHouseImpl),
            address(auctionHouseProxyAdmin),
            ''
        );
        t.nounsToken = new NounsToken(
            makeAddr('noundersDAO'),
            address(auctionProxy),
            t.descriptor,
            t.seeder,
            t.proxyRegistry
        );
        require(predictedTokenAddress == address(t.nounsToken), 'Token address mismatch');

        auctionHouseProxyAdmin.transferOwnership(address(t.timelock));
        t.nounsToken.transferOwnership(address(t.timelock));

        address daoLogicImplementation = address(new NounsDAOLogicV4());

        uint256 nonce = vm.getNonce(address(this));
        address predictedForkEscrowAddress = computeCreateAddress(address(this), nonce + 6);

        ForkDAODeployer forkDeployer = new ForkDAODeployer(
            address(new NounsTokenFork()),
            address(new NounsAuctionHouseFork()),
            address(new NounsDAOLogicV1Fork()),
            address(new NounsDAOExecutorV2()),
            DELAYED_GOV_DURATION,
            FORK_DAO_VOTING_PERIOD,
            FORK_DAO_VOTING_DELAY,
            FORK_DAO_PROPOSAL_THRESHOLD_BPS,
            FORK_DAO_QUORUM_VOTES_BPS
        );

        INounsDAOLogic dao = INounsDAOLogic(
            payable(
                new NounsDAOProxyV3(
                    address(t.timelock),
                    address(t.nounsToken),
                    predictedForkEscrowAddress,
                    address(forkDeployer),
                    makeAddr('vetoer'),
                    address(t.timelock),
                    daoLogicImplementation,
                    NounsDAOTypes.NounsDAOParams({
                        votingPeriod: VOTING_PERIOD,
                        votingDelay: VOTING_DELAY,
                        proposalThresholdBPS: PROPOSAL_THRESHOLD,
                        lastMinuteWindowInBlocks: LAST_MINUTE_BLOCKS,
                        objectionPeriodDurationInBlocks: OBJECTION_PERIOD_BLOCKS,
                        proposalUpdatablePeriodInBlocks: UPDATABLE_PERIOD_BLOCKS
                    }),
                    NounsDAOTypes.DynamicQuorumParams({
                        minQuorumVotesBPS: 200,
                        maxQuorumVotesBPS: 2000,
                        quorumCoefficient: 10000
                    })
                )
            )
        );

        address(new NounsDAOForkEscrow(address(dao), address(t.nounsToken)));

        ChainalysisSanctionsListMock sanctionsOracle = new ChainalysisSanctionsListMock();

        vm.prank(address(t.timelock));
        NounsAuctionHouseV3(address(auctionProxy)).initialize({
            _reservePrice: 0,
            _timeBuffer: 2,
            _minBidIncrementPercentage: 1,
            _sanctionsOracle: sanctionsOracle
        });

        vm.prank(address(t.timelock));
        t.timelock.setPendingAdmin(address(dao));
        vm.prank(address(dao));
        t.timelock.acceptAdmin();

        vm.startPrank(address(t.timelock));
        dao._setForkPeriod(FORK_PERIOD);
        dao._setForkThresholdBPS(FORK_THRESHOLD_BPS);
        vm.stopPrank();

        return dao;
    }

    function _deployDAOV3() internal returns (INounsDAOLogic) {
        return _deployDAOV3WithParams(10 minutes);
    }
}
