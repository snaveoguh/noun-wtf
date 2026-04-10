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
      <h1
        className="mb-0 font-['Londrina_Solid'] text-[42px] md:text-[38px] lg:text-[42px]"
        style={{ color, lineHeight: 0.85, margin: 0 }}
      >
        Noun
      </h1>
      <span
        className="block font-['Londrina_Solid'] text-[62px] md:text-[54px] lg:text-[62px]"
        style={{ color, lineHeight: 0.85 }}
      >
        {nounId.toString()}
      </span>
    </div>
  );
};
export default AuctionActivityNounTitle;
