import React from 'react';

import { blo } from 'blo';
import { useEnsAvatar, useEnsName } from 'wagmi';

import { getNoun } from '@/components/StandaloneNoun';
import { formatShortAddress, stripNoggles } from '@/utils/addressAndENSDisplayUtils';
import { resolveNounContractAddress } from '@/utils/resolveNounsContractAddress';
import { Address } from '@/utils/types';
import { type INounSeed, useNounSeed } from '@/wrappers/nounToken';

const AVATAR_SIZE = 36;

/**
 * Resolves an avatar src for an address. Mirrors the lookup chain used in
 * `ShortAddress.tsx`: ENS avatar (if name resolves) → blo() pixelblock fallback
 * keyed off the raw address. Used as the small icon in the toast body.
 */
const useActorAvatar = (address: Address | undefined) => {
  const { data: ensName } = useEnsName({ address });
  // Pass the original (unstripped) ENS name to `useEnsAvatar` so `.noggles`
  // names still resolve their avatar — the strip is display-only.
  const avatarLookupName =
    ensName ?? (address ? resolveNounContractAddress(address) : undefined);
  const { data: ensAvatar } = useEnsAvatar({ name: avatarLookupName ?? undefined });
  const fallback = address ? blo(address) : undefined;
  const resolvedName =
    (ensName ? stripNoggles(ensName) : undefined) ||
    (address ? resolveNounContractAddress(address) : undefined);
  const displayName = resolvedName ?? (address ? formatShortAddress(address) : '');
  return { src: ensAvatar ?? fallback, displayName };
};

interface AddressToastProps {
  address: Address;
  text: (displayName: string) => React.ReactNode;
}

/**
 * Toast body keyed off an actor address. The actor's display name (ENS or
 * truncated hex) is injected into the text via render-prop so callers can
 * compose copy like `<name> bid 1.23 Ξ on Noun #42`.
 */
export const AddressToast: React.FC<AddressToastProps> = ({ address, text }) => {
  const { src, displayName } = useActorAvatar(address);
  return (
    <div className="flex flex-row items-center gap-2.5">
      {src && (
        <img
          alt={address}
          src={src}
          className="shrink-0 rounded-full"
          style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
        />
      )}
      <div className="text-sm leading-tight">{text(displayName)}</div>
    </div>
  );
};

interface NounToastProps {
  nounId: bigint;
  text: React.ReactNode;
}

/**
 * Toast body that renders the on-chain noun image as the icon (e.g. for
 * "Noun #N settled" where the noun *is* the subject). Falls back to nothing
 * while the seed is loading — sonner will still show the text on its own.
 */
export const NounToast: React.FC<NounToastProps> = ({ nounId, text }) => {
  const seed = useNounSeed(nounId);
  const noun = seed ? getNoun(nounId, seed as INounSeed) : undefined;
  return (
    <div className="flex flex-row items-center gap-2.5">
      {noun?.image && (
        <img
          alt={`Noun ${nounId.toString()}`}
          src={noun.image}
          className="shrink-0 rounded-md"
          style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, background: '#d5d7e1' }}
        />
      )}
      <div className="text-sm leading-tight">{text}</div>
    </div>
  );
};
