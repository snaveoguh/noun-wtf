import { lazy, Suspense } from 'react';

import { i18n } from '@lingui/core';
import { Trans } from '@lingui/react/macro';
import {
  useReadNounsTreasuryBalancesInEth,
  useReadNounsTreasuryBalancesInUsd,
} from '@nouns/sdk/react/treasury';
import clsx from 'clsx';
import { Col, Row } from 'react-bootstrap';
import { Link, useSearchParams } from 'react-router';
import { formatEther, formatUnits } from 'viem';

import Proposals from '@/components/Proposals';
import { GenericSkeleton } from '@/components/Skeleton';
import Section from '@/layout/Section';
import { useAllProposals, useProposalThreshold } from '@/wrappers/nounsDao';

import classes from './Governance.module.css';

const YellowCollectiveProposals = lazy(() => import('./YellowCollectiveProposals'));
const LilNounsProposals = lazy(() => import('./LilNounsProposals'));

type DaoTab = 'nouns' | 'yc' | 'lil';

const GovernancePage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const daoParam = searchParams.get('dao');
  const daoTab: DaoTab = daoParam === 'yc' ? 'yc' : daoParam === 'lil' ? 'lil' : 'nouns';

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
      {/* NounV2 announcement — deep-links to the main auction with the NounV2
          toggle pre-selected, so the switcher state stays consistent. */}
      <Link
        to="/?dao=nounv2"
        className="block no-underline"
        style={{ textDecoration: 'none' }}
      >
        <div className="mx-4 mt-3 mb-1 flex items-center justify-between gap-3 rounded-md bg-red-600 px-4 py-3 text-white shadow-sm transition-colors hover:bg-red-700 sm:mx-6">
          <div className="flex items-center gap-3">
            <span className="rounded bg-white/20 px-2 py-0.5 text-[0.65rem] font-extrabold uppercase tracking-[0.1em]">
              New
            </span>
            <span className="text-sm font-bold sm:text-base">
              NounV2 — no-reserve auctions live
            </span>
          </div>
          <span className="text-sm font-extrabold" aria-hidden>
            &rarr;
          </span>
        </div>
      </Link>

      {/* DAO Tab Bar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'center',
          padding: '16px 16px 0',
        }}
      >
        <button
          onClick={() => setDao('nouns')}
          style={{
            padding: '8px 20px',
            borderRadius: 20,
            fontSize: '0.85rem',
            fontWeight: 700,
            fontFamily: "'PT Root UI', sans-serif",
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.15s',
            background: daoTab === 'nouns' ? '#14141f' : '#f4f4f8',
            color: daoTab === 'nouns' ? '#fff' : '#8c8d92',
          }}
        >
          Nouns DAO
        </button>
        <button
          onClick={() => setDao('yc')}
          style={{
            padding: '8px 20px',
            borderRadius: 20,
            fontSize: '0.85rem',
            fontWeight: 700,
            fontFamily: "'PT Root UI', sans-serif",
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.15s',
            background: daoTab === 'yc' ? '#FFC700' : '#f4f4f8',
            color: daoTab === 'yc' ? '#14141f' : '#8c8d92',
          }}
        >
          Yellow
        </button>
        <button
          onClick={() => setDao('lil')}
          style={{
            padding: '8px 20px',
            borderRadius: 20,
            fontSize: '0.85rem',
            fontWeight: 700,
            fontFamily: "'PT Root UI', sans-serif",
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.15s',
            background: daoTab === 'lil' ? '#ff638d' : '#f4f4f8',
            color: daoTab === 'lil' ? '#fff' : '#8c8d92',
          }}
        >
          LIL NOUNS
        </button>
      </div>

      {daoTab === 'nouns' ? (
        <>
          <Section fullWidth={false} className={classes.section}>
            <Col xs={12} lg={10} className={classes.wrapper}>
              <Row className={classes.headerRow}>
                <span>
                  <Trans>Governance</Trans>
                </span>
                <h1>
                  <Trans>Nouns DAO</Trans>
                </h1>
              </Row>
              <p className={classes.subheading}>{subHeading}</p>

              <Row className={classes.treasuryInfoCard}>
                <Col lg={8} className={classes.treasuryAmtWrapper}>
                  <Row className={classes.headerRow}>
                    <span>
                      <Trans>Treasury</Trans>
                    </span>
                  </Row>
                  <Row>
                    <Col className={clsx(classes.ethTreasuryAmt)} lg={3}>
                      <h1 className={classes.ethSymbol}>Ξ</h1>
                      <h1>
                        {treasuryBalance != undefined &&
                          i18n.number(Number(Number(formatEther(treasuryBalance)).toFixed(0)))}
                      </h1>
                    </Col>
                    <Col className={classes.usdTreasuryAmt}>
                      <h1 className={classes.usdBalance}>
                        {treasuryBalanceUSD !== undefined &&
                          i18n.number(Number(formatUnits(treasuryBalanceUSD, 6)), {
                            style: 'currency',
                            currency: 'USD',
                          })}
                      </h1>
                    </Col>
                  </Row>
                </Col>
                <Col className={classes.treasuryInfoText}>
                  <Trans>
                    This treasury exists for <span className={classes.boldText}>Nouns DAO</span>{' '}
                    participants to allocate resources for the long-term growth and prosperity of
                    the Nouns project.
                  </Trans>
                </Col>
              </Row>
            </Col>
          </Section>

          <Proposals proposals={proposals ?? []} nounsRequired={nounsRequired} />
        </>
      ) : daoTab === 'yc' ? (
        <Suspense fallback={<GenericSkeleton />}>
          <YellowCollectiveProposals />
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
