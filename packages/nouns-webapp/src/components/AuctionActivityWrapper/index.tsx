import React from 'react';

interface AuctionActivityWrapperProps {
  children: React.ReactNode;
}

const AuctionActivityWrapper: React.FC<AuctionActivityWrapperProps> = ({ children }) => {
  // `position: relative` lets descendants (e.g. BurnedNounContent's
  // top-right nav arrows) anchor against the card edge instead of the
  // page viewport.
  // No side margins: the hero already pads the column (a viewport `max-lg:mx-4`
  // here pushed the bid 16 px out of line with the title on phones).
  return <div className="relative">{children}</div>;
};
export default AuctionActivityWrapper;
