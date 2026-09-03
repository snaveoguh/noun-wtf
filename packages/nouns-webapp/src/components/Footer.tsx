import { Trans, useLingui } from '@lingui/react/macro';
import { Link } from 'react-router';

import DiscordIcon from '@/assets/icons/socials/discord.svg?react';
import FarcasterIcon from '@/assets/icons/socials/farcaster.svg?react';
import GitHubIcon from '@/assets/icons/socials/github.svg?react';
import XIcon from '@/assets/icons/socials/x.svg?react';
import NogglesLogo from '@/assets/noggles.svg?react';
import {
  nounsAuctionHouseAddress,
  nounsDescriptorAddress,
  nounsGovernorAddress,
  nounsTokenAddress,
  nounsTreasuryAddress,
} from '@/contracts';
import { buildEtherscanAddressLink } from '@/utils/etherscan';
import { defaultChain } from '@/wagmi';

export const Footer = () => {
  const { t } = useLingui();
  const categories: { category: string; items: { label: string; url: string }[] }[] = [
    {
      category: 'Nouns DAO',
      items: [
        { label: t`Auction`, url: '/' },
        { label: t`Governance`, url: '/vote' },
        { label: t`Candidates`, url: '/candidates' },
        { label: t`Grants`, url: '/grants' },
        { label: t`NounV2`, url: '/v2' },
        { label: t`Wallet explorer`, url: '/explore/wallet' },
        { label: t`Stats`, url: '/stats' },
      ],
    },
    {
      category: 'Nouns',
      items: [
        { label: t`Nouns`, url: '/nouns' },
        { label: t`Traits`, url: '/traits' },
        { label: t`Settlers`, url: '/settlers' },
        { label: t`Nounders`, url: '/nounders' },
        { label: t`Playground`, url: '/playground' },
        { label: t`Dreams`, url: '/dreams' },
        { label: t`Probe`, url: '/probe' },
        { label: t`Crystal ball`, url: '/crystal-ball' },
      ],
    },
    {
      category: 'Contracts',
      items: [
        { label: t`Token`, url: buildEtherscanAddressLink(nounsTokenAddress[defaultChain.id]) },
        {
          label: t`Auction`,
          url: buildEtherscanAddressLink(nounsAuctionHouseAddress[defaultChain.id]),
        },
        {
          label: t`Governor`,
          url: buildEtherscanAddressLink(nounsGovernorAddress[defaultChain.id]),
        },
        {
          label: t`Descriptor`,
          url: buildEtherscanAddressLink(nounsDescriptorAddress[defaultChain.id]),
        },
        {
          label: t`Treasury`,
          url: buildEtherscanAddressLink(nounsTreasuryAddress[defaultChain.id]),
        },
      ],
    },
  ];

  const socialItems: { alt: string; url: string; icon: React.ReactNode }[] = [
    { alt: 'X', url: 'https://x.com/nounsdao', icon: <XIcon className="size-6 p-0.5" /> },
    {
      alt: 'Farcaster',
      url: 'https://farcaster.xyz/~/channel/nouns',
      icon: <FarcasterIcon className="size-6" />,
    },
    {
      alt: 'GitHub',
      url: 'https://github.com/snaveoguh/noun-wtf',
      icon: <GitHubIcon className="size-6" />,
    },
    {
      alt: 'Discord',
      url: 'https://discord.gg/Z47Qpz26Fe',
      icon: <DiscordIcon className="my-auto h-5" />,
    },
  ];

  return (
    <footer
      className="mt-10 border-t px-6 py-10 sm:mt-20 sm:!p-10 lg:!p-12"
      style={{ borderTopColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg-primary)' }}
    >
      <div className="flex flex-wrap-reverse items-end justify-between gap-10">
        <section className="flex flex-grow items-center justify-center gap-4 sm:justify-normal">
          {socialItems.map(({ alt, url, icon }) => (
            <Link
              className="transition-opacity hover:opacity-70"
              style={{ color: 'var(--theme-text-primary)' }}
              key={alt}
              aria-label={alt}
              to={url}
              target="_blank"
              rel="noreferrer"
            >
              {icon}
            </Link>
          ))}
        </section>
        <div className="mx-auto flex flex-wrap gap-12 sm:mx-0">
          {categories.map(({ category, items }) => (
            <section key={category}>
              <h3
                className="mb-2 text-base font-bold"
                style={{ color: 'var(--theme-text-primary)' }}
              >
                {category}
              </h3>
              <ul className="list-none space-y-1 pl-0">
                {items.map(({ label, url }) => (
                  <li key={label}>
                    <Link
                      to={url}
                      target={url.startsWith('/') ? undefined : '_blank'}
                      rel={url.startsWith('/') ? undefined : 'noreferrer'}
                      className="font-medium no-underline hover:text-red-500"
                      style={{ color: 'var(--theme-text-primary)' }}
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <div
        className="mt-12 flex items-center justify-center text-base sm:mt-16"
        style={{ color: 'var(--theme-text-primary)' }}
      >
        <p className="m-0 p-1">{`${new Date().getFullYear()} noun.wtf`}</p>·
        <p className="m-0 p-1">
          <Trans>
            made with <NogglesLogo className="inline-block h-3 align-baseline" />
          </Trans>
        </p>
      </div>
    </footer>
  );
};
