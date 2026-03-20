import React from 'react';

import { Trans } from '@lingui/react/macro';
import clsx from 'clsx';
import { Link } from 'react-router';
import { useBlockNumber } from 'wagmi';

import ByLineHoverCard from '@/components/ByLineHoverCard';
import HoverCard from '@/components/HoverCard';
import { transactionIconLink } from '@/components/ProposalContent';
import ShortAddress from '@/components/ShortAddress';
import { useActiveLocale } from '@/hooks/useActivateLocale';
import { Locales } from '@/i18n/locales';
import { buildEtherscanAddressLink } from '@/utils/etherscan';
import { isMobileScreen } from '@/utils/isMobile';
import { relativeTimestamp } from '@/utils/timeUtils';
import { useUserVotesAsOfBlock } from '@/wrappers/nounToken';

import classes from './ProposalHeader.module.css';

import navBarButtonClasses from '@/components/NavBarButton/NavBarButton.module.css';

interface CandidateHeaderProps {
  title: string;
  id: string;
  proposer: string;
  versionsCount: number;
  createdTransactionHash: string;
  lastUpdatedTimestamp: number;
  isActiveForVoting?: boolean;
  isWalletConnected: boolean;
  isCandidate?: boolean;
  isUpdateToProposal?: boolean;
  submitButtonClickHandler: () => void;
}

const CandidateHeader: React.FC<CandidateHeaderProps> = props => {
  const {
    title,
    proposer,
    versionsCount,
    createdTransactionHash,
    lastUpdatedTimestamp,
    isActiveForVoting,
    isWalletConnected,
    isUpdateToProposal,
  } = props;
  const isMobile = isMobileScreen();
  const { data: currentBlock } = useBlockNumber();
  const availableVotes = useUserVotesAsOfBlock(Number(currentBlock)) ?? 0;
  const activeLocale = useActiveLocale();

  const voteButton = (
    <>
      {isWalletConnected ? (
        <>
          {!availableVotes && (
            <div className={classes.noVotesText}>
              <Trans>You have no votes.</Trans>
            </div>
          )}
        </>
      ) : (
        <div className={classes.connectWalletText}>
          <Trans>Connect a wallet to vote.</Trans>
        </div>
      )}
    </>
  );

  const proposerLink = (
    <a
      href={buildEtherscanAddressLink(proposer || '')}
      target="_blank"
      rel="noreferrer"
      className={classes.proposerLinkJp}
    >
      <ShortAddress address={(proposer as `0x${string}`) || '0x'} avatar={false} />
    </a>
  );

  const subHead = (
    <>{isUpdateToProposal === true ? <strong>Update</strong> : ''} Proposal Candidate</>
  );
  const transactionLink = transactionIconLink(createdTransactionHash);
  return (
    <>
      <div className={classes.backButtonWrapper}>
        <Link to={props.isCandidate === true ? '/candidates' : '/vote'}>
          <button type="button" className={clsx(classes.backButton, navBarButtonClasses.whiteInfo)}>
            ←
          </button>
        </Link>
      </div>
      <div className="d-flex justify-content-between align-items-center">
        <div className="d-flex justify-content-start align-items-start">
          <div className={classes.headerRow}>
            <span>
              <div className="d-flex">
                <div>{subHead}</div>
              </div>
            </span>
            <div className={classes.proposalTitleWrapper}>
              <div className={classes.proposalTitle}>
                <h1>{title} </h1>
              </div>
            </div>
          </div>
        </div>
        {!isMobile && (
          <div className="d-flex justify-content-end align-items-end">
            {isActiveForVoting === true && voteButton}
          </div>
        )}
      </div>

      <div className={classes.byLineWrapper}>
        {activeLocale === Locales.ja_JP ? (
          <HoverCard
            hoverCardContent={(tip: string) => <ByLineHoverCard proposerAddress={tip} />}
            tip={proposer || ''}
            id="byLineHoverCard"
          >
            <div className={classes.proposalByLineWrapperJp}>
              <Trans>
                <span className={classes.proposedByJp}>Proposed by: </span>
                <span className={classes.proposerJp}>{proposerLink}</span>
                {transactionLink}
              </Trans>
            </div>
          </HoverCard>
        ) : (
          <>
            <h3>Proposed by</h3>

            <div className={classes.byLineContentWrapper}>
              <HoverCard
                hoverCardContent={(tip: string) => <ByLineHoverCard proposerAddress={tip} />}
                tip={proposer || ''}
                id="byLineHoverCard"
              >
                <h3>
                  {proposerLink}
                  {transactionLink}
                </h3>
              </HoverCard>
            </div>
          </>
        )}
      </div>

      <p className={classes.versionHistory} style={{ fontSize: 13, opacity: 0.6 }}>
        Version {versionsCount} · {versionsCount === 1 ? 'created' : 'updated'}{' '}
        {relativeTimestamp(lastUpdatedTimestamp)}
      </p>

      {isMobile && (
        <div className={classes.mobileSubmitProposalButton}>
          {isActiveForVoting === true && voteButton}
        </div>
      )}
    </>
  );
};

export default CandidateHeader;
