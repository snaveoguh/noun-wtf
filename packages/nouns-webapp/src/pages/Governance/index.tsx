import { lazy, Suspense } from 'react';

import { i18n } from '@lingui/core';
import { Trans } from '@lingui/react/macro';
import {
  useReadNounsTreasuryBalancesInEth,
  useReadNounsTreasuryBalancesInUsd,
} from '@nouns/sdk/react/treasury';
import clsx from 'clsx';
import { Link, useSearchParams } from 'react-router';
import { formatEther, formatUnits } from 'viem';

import Proposals from '@/components/Proposals';
import { GenericSkeleton } from '@/components/Skeleton';
import Section from '@/layout/Section';
import { useAllProposals, useProposalThreshold } from '@/wrappers/nounsDao';

import classes from './Governance.module.css';

const YellowCollectiveProposals = lazy(() => import('./YellowCollectiveProposals'));
const LilNounsProposals = lazy(() => import('./LilNounsProposals'));
const NounV2Proposals = lazy(() => import('./NounV2Proposals'));

type DaoTab = 'nouns' | 'yc' | 'lil' | 'nounv2';

const GovernancePage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const daoParam = searchParams.get('dao');
  const daoTab: DaoTab =
    daoParam === 'yc'
      ? 'yc'
      : daoParam === 'lil'
        ? 'lil'
        : daoParam === 'nounv2'
          ? 'nounv2'
          : 'nouns';

  const { data: proposals } = useAllProposals();
  const threshold = useProposalThreshold();
  const nounsRequired = threshold == null ? undefined : threshold + 1;

  const treasuryBalance = useReadNounsTreasuryBalancesInEth({
    query: {
      select: balances => balances.total,
    },
  }).data;
  const treasuryBalanceUSD = useReadNounsTreasuryBalancesInUsd({
    query: {
      select: balances => balances.total,
    },
  }).data;

  const nounSingular = <Trans>Noun</Trans>;
  const nounPlural = <Trans>Nouns</Trans>;
  const subHeading = (
    <Trans>
      Nouns govern <span className={classes.boldText}>Nouns DAO</span>. Nouns can vote on proposals
      or delegate their vote to a third party. A minimum of{' '}
      <span className={classes.boldText}>
        {nounsRequired !== undefined ? (
          <>
            {nounsRequired} {threshold === 0 ? nounSingular : nounPlural}
          </>
        ) : (
          '...'
        )}
      </span>{' '}
      is required to submit proposals.
    </Trans>
  );

  const setDao = (tab: DaoTab) => {
    if (tab === 'nouns') {
      searchParams.delete('dao');
      setSearchParams(searchParams, { replace: true });
    } else {
      setSearchParams({ dao: tab }, { replace: true });
    }
  };

  return (
    <>
      {/* DAO Tab Bar */}
      <div className={classes.daoTabs} role="tablist" aria-label="DAO">
        <button
          type="button"
          role="tab"
          aria-selected={daoTab === 'nouns'}
          onClick={() => setDao('nouns')}
          className={classes.daoTab}
          style={{
            background: daoTab === 'nouns' ? '#14141f' : 'var(--theme-bg-card)',
            color: daoTab === 'nouns' ? '#fff' : '#8c8d92',
          }}
        >
          Nouns DAO
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={daoTab === 'nounv2'}
          onClick={() => setDao('nounv2')}
          aria-label="NounV2"
          title="NounV2"
          className={clsx(classes.daoTab, classes.daoTabRound)}
          style={{
            background: daoTab === 'nounv2' ? 'var(--theme-negative)' : 'var(--theme-bg-card)',
            color: daoTab === 'nounv2' ? '#fff' : 'var(--theme-negative)',
          }}
        >
          V2
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={daoTab === 'yc'}
          onClick={() => setDao('yc')}
          className={classes.daoTab}
          style={{
            background: daoTab === 'yc' ? '#FFC700' : 'var(--theme-bg-card)',
            color: daoTab === 'yc' ? '#14141f' : '#8c8d92',
          }}
        >
          Yellow
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={daoTab === 'lil'}
          onClick={() => setDao('lil')}
          className={classes.daoTab}
          style={{
            background: daoTab === 'lil' ? '#ff638d' : 'var(--theme-bg-card)',
            color: daoTab === 'lil' ? '#fff' : '#8c8d92',
          }}
        >
          LIL NOUNS
        </button>
      </div>

      {daoTab === 'nouns' ? (
        <>
          <Section fullWidth={false} className={classes.section}>
            <div className={classes.wrapper}>
              <div className={classes.headerRow}>
                <span>
                  <Trans>Governance</Trans>
                </span>
                <h1>
                  <Trans>Nouns DAO</Trans>
                </h1>
              </div>
              <p className={classes.subheading}>{subHeading}</p>

              <div className={classes.treasuryInfoCard}>
                <div className={classes.treasuryAmtWrapper}>
                  <div className={clsx(classes.headerRow, classes.treasuryHeading)}>
                    <Link to="/nonsense" className={classes.treasuryLink}>
                      <Trans>Treasury</Trans>
                    </Link>
                  </div>
                  <div className={classes.treasuryAmts}>
                    <div className={classes.ethTreasuryAmt}>
                      <h1 className={classes.ethSymbol}>Ξ</h1>
                      <h1>
                        {treasuryBalance != undefined &&
                          i18n.number(Number(Number(formatEther(treasuryBalance)).toFixed(0)))}
                      </h1>
                    </div>
                    <div className={classes.usdTreasuryAmt}>
                      <h1 className={classes.usdBalance}>
                        {treasuryBalanceUSD !== undefined &&
                          i18n.number(Number(formatUnits(treasuryBalanceUSD, 6)), {
                            style: 'currency',
                            currency: 'USD',
                          })}
                      </h1>
                    </div>
                  </div>
                </div>
                <div className={classes.treasuryInfoText}>
                  <Trans>
                    This treasury exists for <span className={classes.boldText}>Nouns DAO</span>{' '}
                    participants to allocate resources for the long-term growth and prosperity of
                    the Nouns project.
                  </Trans>{' '}
                  <Link to="/nonsense" className={classes.treasuryLink}>
                    <Trans>What it holds, where it came from and where it went →</Trans>
                  </Link>
                </div>
              </div>
            </div>
          </Section>

          <Proposals proposals={proposals ?? []} nounsRequired={nounsRequired} />
        </>
      ) : daoTab === 'yc' ? (
        <Suspense fallback={<GenericSkeleton />}>
          <YellowCollectiveProposals />
        </Suspense>
      ) : daoTab === 'nounv2' ? (
        <Suspense fallback={<GenericSkeleton />}>
          <NounV2Proposals />
        </Suspense>
      ) : (
        <Suspense fallback={<GenericSkeleton />}>
          <LilNounsProposals />
        </Suspense>
      )}
    </>
  );
};
export default GovernancePage;
