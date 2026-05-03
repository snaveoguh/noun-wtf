import clsx from 'clsx';

import { CandidateSignature } from '@/wrappers/nounsData';

import CandidateSponsorImage from './CandidateSponsorImage';
import classes from './CandidateSponsors.module.css';

type CandidateSponsorsProps = {
  signers: CandidateSignature[];
  nounIds: string[];
  nounsRequired: number;
  isThresholdMetByProposer?: boolean;
};

const CandidateSponsors = ({
  signers,
  nounIds,
  nounsRequired,
  isThresholdMetByProposer,
}: CandidateSponsorsProps) => {
  const maxVisibleSpots = 5;
  const signerCountOverflow = signers.length > maxVisibleSpots ? signers.length - maxVisibleSpots : 0;
  const placeholderCount =
    isThresholdMetByProposer && nounIds.length === 0 ? 1 : nounsRequired - nounIds.length;
  const placeholderArray = Array(placeholderCount >= 1 ? placeholderCount : 0).fill(0);

  return (
    <div
      className={clsx(
        classes.sponsorsWrap,
        signerCountOverflow > 0 && classes.sponsorsWrapOverflow,
      )}
    >
      {nounIds.length > 0 && (
        <div className={classes.sponsors}>
          {nounIds.map((nounId, i) => {
            if (i >= maxVisibleSpots) return null;
            return <CandidateSponsorImage nounId={BigInt(+nounId)} key={`${i}-${nounId}`} />;
          })}
        </div>
      )}
      {placeholderArray.map((_, i) => (
        <div className={classes.emptySponsorSpot} key={i} />
      ))}
    </div>
  );
};

export default CandidateSponsors;
