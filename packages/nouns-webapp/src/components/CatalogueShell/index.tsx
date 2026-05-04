import type { ReactNode } from 'react';

import { Trans } from '@lingui/react/macro';
import clsx from 'clsx';
import { ConnectKitButton } from 'connectkit';
import { Container, Nav, Navbar } from 'react-bootstrap';

import NogglesLogo from '@/assets/noggles.svg?react';
import NavBarButton, { NavBarButtonStyle } from '@/components/NavBarButton';
import ShortAddress from '@/components/ShortAddress';
import ThemeSwitcher from '@/components/ThemeSwitcher';

import classes from './CatalogueShell.module.css';

export default function CatalogueShell({ children }: { children: ReactNode }) {
  return (
    <div data-catalogue-shell className={classes.shell}>
      <Navbar expand style={{ backgroundColor: 'transparent' }} className={classes.nav}>
        <Container fluid className={classes.navInner}>
          <Navbar.Brand as="span" className={classes.brand} title="Catalogue — emulation only">
            <NogglesLogo className={classes.logo} aria-label="Nouns DAO" />
            <span className={classes.brandWord}>Catalogue</span>
          </Navbar.Brand>
          <Nav className={clsx('justify-content-end', classes.right)}>
            <a
              href="https://cc0-lib.wtf"
              target="_blank"
              rel="noopener noreferrer"
              className={classes.fullUxBtn}
              title="Open cc0-lib.wtf in a new tab"
            >
              <span>cc0-lib.wtf</span>
              <span aria-hidden className={classes.fullUxArrow}>→</span>
            </a>
            <ConnectKitButton.Custom>
              {({ isConnected, show, address }) => {
                if (!isConnected) {
                  return (
                    <NavBarButton
                      buttonText={<Trans>Connect</Trans>}
                      buttonStyle={NavBarButtonStyle.WHITE_INFO}
                      onClick={show}
                    />
                  );
                }
                return (
                  <NavBarButton
                    buttonText={<ShortAddress address={address!} avatar={true} size={28} avatarOnly />}
                    buttonStyle={NavBarButtonStyle.WHITE_INFO}
                    onClick={show}
                  />
                );
              }}
            </ConnectKitButton.Custom>
            <ThemeSwitcher variant="navbar" />
          </Nav>
        </Container>
      </Navbar>
      <main className={classes.main}>{children}</main>
    </div>
  );
}
