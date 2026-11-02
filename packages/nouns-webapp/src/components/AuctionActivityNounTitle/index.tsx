import React from 'react';

interface AuctionActivityNounTitleProps {
  nounId: bigint;
  isCool?: boolean;
}

const AuctionActivityNounTitle: React.FC<AuctionActivityNounTitleProps> = props => {
  const { nounId, isCool } = props;
  const color = isCool === true ? 'var(--brand-cool-dark-text)' : 'var(--brand-warm-dark-text)';
  return (
    <div className="inline-block leading-[0.85]">
      {/* Sizes follow the auction column's width (container units), so the
          title never clips in a narrow window; 42 / 62 px at full size. */}
      <h1
        className="mb-0 font-['Londrina_Solid']"
        style={{ color, lineHeight: 0.85, margin: 0, fontSize: 'clamp(30px, 12cqi, 42px)' }}
      >
        Noun
      </h1>
      <span
        className="block font-['Londrina_Solid']"
        style={{ color, lineHeight: 0.85, fontSize: 'clamp(44px, 18cqi, 62px)' }}
      >
        {nounId.toString()}
      </span>
    </div>
  );
};
export default AuctionActivityNounTitle;
