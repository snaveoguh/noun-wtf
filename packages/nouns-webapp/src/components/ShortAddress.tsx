import React from 'react';

import { blo } from 'blo';
import { useEnsAvatar, useEnsName } from 'wagmi';

import {
  formatShortAddress,
  isNogglesName,
  stripNoggles,
} from '@/utils/addressAndENSDisplayUtils';
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
  // The noggles namespace is rugged — never surface those names or fetch
  // their avatars. `stripNoggles` returns '' for noggles-namespace results,
  // so the fallback chain below collapses to short address (or noun-contract
  // resolved name where applicable).
  const displayEnsName = stripNoggles(ensName) || null;
  const resolvedName = displayEnsName || resolveNounContractAddress(address);
  const isBlocklisted = resolvedName ? containsBlockedText(resolvedName, 'en') : false;
  const shortAddress = formatShortAddress(address);
  const avatarLookupName = isNogglesName(ensName)
    ? resolveNounContractAddress(address)
    : (ensName ?? resolveNounContractAddress(address));
  const { data: ensAvatar } = useEnsAvatar({
    name: avatarLookupName,
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
