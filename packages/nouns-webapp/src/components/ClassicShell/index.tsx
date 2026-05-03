import type { ReactNode } from 'react';

import { Trans } from '@lingui/react/macro';
import { useReadNounsTreasuryBalancesInEth } from '@nouns/sdk/react/treasury';
import clsx from 'clsx';
import { ConnectKitButton } from 'connectkit';
import { Container, Nav, Navbar } from 'react-bootstrap';
import { Link } from 'react-router';
import { formatEther } from 'viem';

import NogglesLogo from '@/assets/noggles.svg?react';
import NavBarButton, { NavBarButtonStyle } from '@/components/NavBarButton';
import NavBarTreasury from '@/components/NavBarTreasury';
import ShortAddress from '@/components/ShortAddress';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { nounsTreasuryAddress } from '@/contracts';
import { useAppSelector } from '@/hooks';
import { buildEtherscanAddressLink } from '@/utils/etherscan';
import { defaultChain } from '@/wagmi';

import classes from './ClassicNav.module.css';

interface ClassicShellProps {
  children: ReactNode;
}

export default function ClassicShell({ children }: ClassicShellProps) {
  const chainId = defaultChain.id;
  const treasuryBalance = useReadNounsTreasuryBalancesInEth({
    query: { select: data => data.total },
  }).data;
  const daoEtherscanLink = buildEtherscanAddressLink(nounsTreasuryAddress[chainId]);
  const nounBg = useAppSelector(s => s.application.stateBackgroundColor);

  const buttonStyle = NavBarButtonStyle.WHITE_INFO;

  return (
    <div
      data-classic-shell
      className={classes.classicShellRoot}
      style={{
        background: nounBg || 'var(--theme-bg-primary, #ffffff)',
        color: 'var(--theme-text-primary, #212529)',
        fontFamily: 'var(--theme-font-body, "PT Root UI"), system-ui, sans-serif',
      }}
    >
      <Navbar expand style={{ backgroundColor: 'transparent' }} className={classes.navBarCustom}>
        <Container fluid className={classes.navBarInner}>
          <div className={classes.brandAndTreasuryWrapper}>
            <Navbar.Brand as={Link} to="/" className={classes.navBarBrand}>
              <NogglesLogo className={classes.navBarLogo} aria-label="Nouns DAO noggles" />
            </Navbar.Brand>
            <Nav.Item className="d-none d-sm-block">
              {treasuryBalance !== undefined && (
                <Nav.Link
                  href={daoEtherscanLink}
                  className={classes.nounsNavLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  <NavBarTreasury
                    treasuryBalance={Number(formatEther(treasuryBalance)).toFixed(0)}
                    treasuryStyle={buttonStyle}
                  />
                </Nav.Link>
              )}
            </Nav.Item>
          </div>

          <div className={clsx('justify-content-end', classes.navBarItems)}>
            <a
              href="https://nouns.wtf"
              target="_blank"
              rel="noopener noreferrer"
              className={classes.fullUxBtn}
              title="Open nouns.wtf in a new tab"
            >
              <span>nouns.wtf</span>
              <span aria-hidden className={classes.fullUxArrow}>→</span>
            </a>
            <ConnectKitButton.Custom>
              {({ isConnected, show, address }) => {
                if (!isConnected) {
                  return (
                    <NavBarButton
                      buttonText={<Trans>Connect</Trans>}
                      buttonStyle={buttonStyle}
                      onClick={show}
                    />
                  );
                }
                return (
                  <NavBarButton
                    buttonText={
                      <ShortAddress address={address!} avatar={true} size={28} avatarOnly />
                    }
                    buttonStyle={buttonStyle}
                    onClick={show}
                  />
                );
              }}
            </ConnectKitButton.Custom>

            <ThemeSwitcher variant="navbar" />
          </div>
        </Container>
      </Navbar>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {children}
      </main>
    </div>
  );
}
