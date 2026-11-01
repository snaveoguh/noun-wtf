import { useEffect, useState } from 'react';

import { i18n } from '@lingui/core';
import { Trans } from '@lingui/react/macro';
import clsx from 'clsx';
import dayjs from 'dayjs';
import advanced from 'dayjs/plugin/advancedFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Col, Row } from 'react-bootstrap';
import ReactDiffViewer from 'react-diff-viewer';
import ReactMarkdown from 'react-markdown';
import { Link, useParams } from 'react-router';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import ProposalContent from '@/components/ProposalContent';
import ProposalTransactionsDiffs from '@/components/ProposalContent/ProposalTransactionsDiffs';
import ProposalStatus from '@/components/ProposalStatus';
import Section from '@/layout/Section';
import { processProposalDescriptionText } from '@/utils/processProposalDescriptionText';
import { useProposal, useProposalVersions } from '@/wrappers/nounsDao';

import VersionTab from './VersionTab';
import classes from './Vote.module.css';

import navBarButtonClasses from '@/components/NavBarButton/NavBarButton.module.css';
import editorClasses from '@/components/ProposalEditor/ProposalEditor.module.css';
import headerClasses from '@/components/ProposalHeader/ProposalHeader.module.css';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advanced);

const ProposalHistory = () => {
  const { id, versionNumber } = useParams<{ id: string; versionNumber?: string }>();
  const [isDiffsVisible, setIsDiffsVisible] = useState(false);
  const [activeVersion, setActiveVersion] = useState(0);
  const [showToast, setShowToast] = useState(true);
  const proposal = useProposal(Number(id));
  const proposalVersions = useProposalVersions(Number(id));

  useEffect(() => {
    if (versionNumber) {
      setActiveVersion(Number(versionNumber));
    } else {
      // if no version number in url, set active version to latest
      setActiveVersion(proposalVersions?.length ?? 0);
    }
  }, [versionNumber, proposalVersions]);

  useEffect(() => {
    if (showToast) {
      setTimeout(() => {
        setShowToast(false);
      }, 5000);
    }
  }, [showToast]);

  // Versions are 1-based; a version the indexer doesn't have (or hasn't loaded yet) renders
  // nothing rather than crashing (/vote/:id/history/1 used to throw on an empty list).
  const currentVersion = activeVersion >= 1 ? proposalVersions?.[activeVersion - 1] : undefined;
  const previousVersion = activeVersion >= 2 ? proposalVersions?.[activeVersion - 2] : undefined;

  const highlightSyntax = (str: string) => {
    return (
      <ReactMarkdown
        className={clsx(editorClasses.markdown, editorClasses.diffs)}
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw]}
      >
        {str}
      </ReactMarkdown>
    );
  };
  const headerDiffs = (str: string) => {
    return <h1 className={classes.titleDiffs}>{str}</h1>;
  };

  return (
    <Section fullWidth={false} className={classes.votePage}>
      <Col lg={12} className={classes.wrapper}>
        {proposal && (
          <>
            <div className={headerClasses.backButtonWrapper}>
              <Link
                to={`/vote/${id}`}
                aria-label={`Back to proposal ${id}`}
                className={clsx(classes.backLink, navBarButtonClasses.whiteInfo)}
              >
                ←
              </Link>
            </div>
            <div className={headerClasses.headerRow}>
              <span>
                <div className="d-flex flex-wrap items-center gap-y-1">
                  <div>
                    <Trans>Proposal {i18n.number(Number(proposal.id || '0'))}</Trans>
                  </div>
                  <div>
                    <ProposalStatus
                      status={proposal?.status}
                      className={headerClasses.proposalStatus}
                    />
                  </div>
                </div>
              </span>
              <div className={headerClasses.proposalTitleWrapper}>
                <div className={clsx(headerClasses.proposalTitle, classes.proposalTitle)}>
                  {isDiffsVisible && previousVersion && currentVersion ? (
                    <div className={classes.diffsWrapper}>
                      <ReactDiffViewer
                        oldValue={previousVersion.title}
                        newValue={currentVersion.title}
                        splitView={false}
                        hideLineNumbers={true}
                        extraLinesSurroundingDiff={10000}
                        renderContent={headerDiffs}
                        disableWordDiff={false}
                        showDiffOnly={false}
                      />
                    </div>
                  ) : (
                    <h1>{currentVersion?.title} </h1>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </Col>
      <Col lg={12} className={clsx(classes.proposal, classes.wrapper)}>
        <div className={classes.historyGrid}>
          <div className="min-w-0">
            {currentVersion && !(isDiffsVisible && previousVersion) && (
              <ProposalContent
                description={currentVersion.description}
                title={currentVersion.title}
                details={currentVersion.details}
                hasSidebar={true}
              />
            )}
            {isDiffsVisible && previousVersion && currentVersion && (
              <div className={classes.diffsWrapper}>
                <Col className={clsx(classes.section, 'm-0 p-0')}>
                  <h5>
                    <Trans>Description</Trans>
                  </h5>
                </Col>
                <ReactDiffViewer
                  oldValue={processProposalDescriptionText(
                    previousVersion.description,
                    previousVersion.title,
                  )}
                  newValue={processProposalDescriptionText(
                    currentVersion.description,
                    currentVersion.title,
                  )}
                  splitView={false}
                  hideLineNumbers={true}
                  extraLinesSurroundingDiff={10000}
                  renderContent={highlightSyntax}
                  disableWordDiff={true}
                  showDiffOnly={false}
                />
                <Row>
                  <Col className={classes.section}>
                    <h5>
                      <Trans>Proposed Transactions</Trans>
                    </h5>
                    <ProposalTransactionsDiffs
                      activeVersionNumber={activeVersion}
                      oldTransactions={previousVersion.details}
                      newTransactions={currentVersion.details}
                    />
                  </Col>
                </Row>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className={classes.versionHistory}>
              <div className={classes.versionHistoryHeader}>
                <h2>Version History</h2>
              </div>
              <div className={classes.versionsList}>
                {proposalVersions &&
                  proposalVersions
                    .map((version, i) => {
                      return (
                        <VersionTab
                          key={i}
                          id={Number(id).toString()}
                          createdAt={Number(version.createdAt)}
                          updateMessage={version.updateMessage}
                          versionNumber={version.versionNumber}
                          isActive={i + 1 === activeVersion}
                          setActiveVersion={setActiveVersion}
                        />
                      );
                    })
                    .reverse()}
              </div>
              {activeVersion > 1 && (
                <button
                  type="button"
                  className={clsx(
                    classes.diffsLink,
                    isDiffsVisible ? classes.diffsLinkActive : classes.diffsLinkInactive,
                  )}
                  onClick={() => setIsDiffsVisible(!isDiffsVisible)}
                >
                  {isDiffsVisible ? 'Hide' : ' View'} diffs
                </button>
              )}
            </div>
          </div>
        </div>
      </Col>
    </Section>
  );
};

export default ProposalHistory;
