import React from 'react';

interface AuctionActivityWrapperProps {
  children: React.ReactNode;
}

const AuctionActivityWrapper: React.FC<AuctionActivityWrapperProps> = ({ children }) => {
  // `position: relative` lets descendants (e.g. BurnedNounContent's
  // top-right nav arrows) anchor against the card edge instead of the
  // page viewport.
  return <div className="max-lg:mx-4 relative">{children}</div>;
};
export default AuctionActivityWrapper;
