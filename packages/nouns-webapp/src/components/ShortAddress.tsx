import React from 'react';

import { blo } from 'blo';
import { useEnsAvatar, useEnsName } from 'wagmi';

import { formatShortAddress, stripNoggles } from '@/utils/addressAndENSDisplayUtils';
import { containsBlockedText } from '@/utils/moderation/containsBlockedText';
import { resolveNounContractAddress } from '@/utils/resolveNounsContractAddress';
import { Address } from '@/utils/types';

interface ShortAddressProps {
  address: Address;
  avatar?: boolean;
  avatarOnly?: boolean;
  size?: number;
}

const ShortAddress: React.FC<ShortAddressProps> = ({
  address,
  avatar = false,
  avatarOnly = false,
  size = 24,
}) => {
  const { data: ensName } = useEnsName({ address });
  // ENS name with `.noggles` namespace stripped for display only — the raw
  // `ensName` is still passed to `useEnsAvatar` so avatar resolution keeps
  // working for `.noggles` names.
  const displayEnsName = ensName ? stripNoggles(ensName) : null;
  const resolvedName = displayEnsName || resolveNounContractAddress(address);
  const isBlocklisted = resolvedName ? containsBlockedText(resolvedName, 'en') : false;
  const shortAddress = formatShortAddress(address);
  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ?? resolveNounContractAddress(address),
  });

  // Guard: address may be undefined during loading / when Ponder hasn't indexed
  if (!address) {
    return null;
  }

  const displayName = resolvedName && !isBlocklisted ? resolvedName : shortAddress;

  if (!avatar) {
    return <>{displayName}</>;
  }

  return (
    <div className="flex flex-row flex-nowrap items-center gap-1.5">
      <img
        key={`${address}-img`}
        className="shrink-0 rounded-full"
        alt={address}
        src={ensAvatar ?? blo(address)}
        style={{ width: size, height: size, backgroundImage: `url(${blo(address)})` }}
      />
      {!avatarOnly && (
        <span className="font-[PT_Root_UI] font-bold tracking-[0.2px]">{displayName}</span>
      )}
    </div>
  );
};

export default ShortAddress;
