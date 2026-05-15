import React, { useEffect } from 'react';

import { getNounData, ImageData as data } from '@noundry/nouns-assets';
import { getNounDataV2, ImageDataV2 } from '@nouns/assets';
import { buildSVG } from '@nouns/sdk';
import Image from 'react-bootstrap/Image';
import { useDispatch } from 'react-redux';
import { Link } from 'react-router';

import burnedNounSvg from '@/assets/loading-skull-noun.gif';
import LegacyNoun from '@/components/LegacyNoun';
import { NounHoverCard } from '@/components/NounHoverCard';
import { setOnDisplayAuctionNounId } from '@/state/slices/onDisplayAuction';
import { INounSeed, isBurnedSeed, useNounSeed } from '@/wrappers/nounToken';

import classes from './StandaloneNoun.module.css';

import nounClasses from '@/components/LegacyNoun/Noun.module.css';

// Placeholder image for burned nouns. We reuse the existing skull-noun asset
// (originally a loading state) because it already conveys "something's up"
// without shipping a new asset. Consumers detect this via isBurnedSeed().
const BURNED_NOUN_IMAGE = burnedNounSvg;

interface StandaloneNounProps {
  nounId: bigint;
}
interface StandaloneCircularNounProps {
  nounId: bigint;
  border?: boolean;
}

interface StandaloneNounWithSeedProps {
  nounId: bigint;
  onLoadSeed?: (seed: INounSeed) => void;
  shouldLinkToProfile: boolean;
}

export const getNoun = (nounId: string | bigint, seed: INounSeed, isV2 = false) => {
  const id = nounId.toString();
  const name = `Noun ${id}`;
  // Burned-seed sentinel (from useNounSeed on a revert). Short-circuit before
  // calling getNounData(-1, -1, …) which would index into ImageData arrays
  // and crash.
  if (isBurnedSeed(seed)) {
    return {
      name,
      description: `Noun ${id} was burned — reserve not met.`,
      image: BURNED_NOUN_IMAGE,
    };
  }
  const description = `Noun ${id} is a member of the Nouns DAO`;
  // V2 traits diverge from `@noundry/nouns-assets` for any trait added or
  // changed on-chain post-fork (e.g. body 30 is `body-lilac` in noundry but
  // `body-white` on V2). Switch to the workspace `@nouns/assets` snapshot
  // which mirrors the V2 descriptor exactly.
  const { parts, background } = isV2 ? getNounDataV2(seed) : getNounData(seed);
  const palette = isV2 ? ImageDataV2.palette : data.palette;
  const image = `data:image/svg+xml;base64,${btoa(buildSVG(parts, palette, background))}`;

  return {
    name,
    description,
    image,
  };
};

/**
 * @deprecated Use [Noun](../Noun.tsx) instead
 */
export const StandaloneNounImage: React.FC<StandaloneNounProps> = (props: StandaloneNounProps) => {
  const { nounId } = props;
  const seed = useNounSeed(nounId);
  const noun = seed && getNoun(nounId, seed);

  return <Image src={noun ? noun.image : ''} fluid />;
};

/**
 * @deprecated Use [Noun](../Noun.tsx) instead
 */
const StandaloneNoun: React.FC<StandaloneNounProps> = (props: StandaloneNounProps) => {
  const { nounId } = props;
  const seed = useNounSeed(nounId);
  const noun = seed && getNoun(nounId, seed);

  const dispatch = useDispatch();

  const onClickHandler = () => {
    dispatch(setOnDisplayAuctionNounId(Number(nounId)));
  };

  return (
    <Link
      to={'/noun/' + nounId.toString()}
      className={classes.clickableNoun}
      onClick={onClickHandler}
    >
      <LegacyNoun imgPath={noun ? noun.image : ''} alt={noun ? noun.description : 'Noun'} />
    </Link>
  );
};

/**
 * @deprecated Use [Noun](../Noun.tsx) instead
 */
export const StandaloneNounCircular: React.FC<StandaloneCircularNounProps> = (
  props: StandaloneCircularNounProps,
) => {
  const { nounId, border } = props;
  const seed = useNounSeed(nounId);
  const noun = seed && getNoun(nounId, seed);

  const dispatch = useDispatch();
  const onClickHandler = () => {
    dispatch(setOnDisplayAuctionNounId(Number(nounId)));
  };

  if (!seed || nounId == undefined)
    return <LegacyNoun imgPath="" alt="Noun" wrapperClassName={nounClasses.circularNounWrapper} />;

  return (
    <NounHoverCard nounId={nounId} seed={seed}>
      <Link
        to={'/noun/' + nounId.toString()}
        className={classes.clickableNoun}
        onClick={onClickHandler}
      >
        <LegacyNoun
          imgPath={noun ? noun.image : ''}
          alt={noun ? noun.description : 'Noun'}
          wrapperClassName={nounClasses.circularNounWrapper}
          className={border === true ? nounClasses.circleWithBorder : nounClasses.circular}
        />
      </Link>
    </NounHoverCard>
  );
};

/**
 * @deprecated Use [Noun](../Noun.tsx) instead
 */
export const StandaloneNounRoundedCorners: React.FC<StandaloneNounProps> = (
  props: StandaloneNounProps,
) => {
  const { nounId } = props;
  const seed = useNounSeed(nounId);
  const noun = seed && getNoun(nounId, seed);

  const dispatch = useDispatch();
  const onClickHandler = () => {
    dispatch(setOnDisplayAuctionNounId(Number(nounId)));
  };

  return (
    <Link
      to={'/noun/' + nounId.toString()}
      className={classes.clickableNoun}
      onClick={onClickHandler}
    >
      <LegacyNoun
        imgPath={noun ? noun.image : ''}
        alt={noun ? noun.description : 'Noun'}
        className={nounClasses.rounded}
      />
    </Link>
  );
};

/**
 * @deprecated Use [Noun](../Noun.tsx) instead
 */
export const StandaloneNounWithSeed: React.FC<StandaloneNounWithSeedProps> = ({
  nounId,
  onLoadSeed,
  shouldLinkToProfile,
}: StandaloneNounWithSeedProps) => {
  const dispatch = useDispatch();
  const seed = useNounSeed(nounId);
  const seedIsInvalid = Object.values(seed || {}).every(v => v === 0);

  useEffect(() => {
    if (seed && !seedIsInvalid && onLoadSeed) {
      onLoadSeed(seed);
    }
  }, [seed, seedIsInvalid, onLoadSeed]);

  if (!seed || seedIsInvalid || nounId == undefined || !onLoadSeed)
    return <LegacyNoun imgPath="" alt="Noun" />;

  const onClickHandler = () => {
    dispatch(setOnDisplayAuctionNounId(Number(nounId)));
  };

  const { image, description } = getNoun(nounId, seed);

  const noun = <LegacyNoun imgPath={image} alt={description} />;
  const nounWithLink = (
    <Link
      to={'/noun/' + nounId.toString()}
      className={classes.clickableNoun}
      onClick={onClickHandler}
    >
      {noun}
    </Link>
  );
  return shouldLinkToProfile ? nounWithLink : noun;
};

export default StandaloneNoun;
