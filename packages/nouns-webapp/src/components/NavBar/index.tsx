import { useState } from 'react';

import { faFile, faPenToSquare, faPlay, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Trans } from '@lingui/react/macro';
import { useReadNounsTreasuryBalancesInEth } from '@nouns/sdk/react/treasury';
import clsx from 'clsx';
import { ConnectKitButton } from 'connectkit';
import { Container, Dropdown, Nav, Navbar } from 'react-bootstrap';
import { Link, useLocation } from 'react-router';
import { formatEther } from 'viem';

import NogglesIcon from '@/assets/icons/Noggles.svg?react';
import NogglesLogo from '@/assets/noggles.svg?react';
import testnetNoun from '@/assets/testnet-noun.png';
import NavBarButton, { NavBarButtonStyle } from '@/components/NavBarButton';
import NavBarTreasury from '@/components/NavBarTreasury';
import NavDropdown from '@/components/NavDropdown';
import NavLocaleSwitcher from '@/components/NavLocaleSwitcher';
import NounPalette from '@/components/NounPalette';
import ShortAddress from '@/components/ShortAddress';
import SubgraphSettings from '@/components/SubgraphSettings';
import config, { CHAIN_ID } from '@/config';
import { nounsTreasuryAddress } from '@/contracts';
import { useAppDispatch, useAppSelector } from '@/hooks';
import { setTorchMode } from '@/state/slices/application';
import { INounSeed } from '@/wrappers/nounToken';
import { usePickByState } from '@/utils/colorResponsiveUIUtils';
import { buildEtherscanAddressLink } from '@/utils/etherscan';
import { defaultChain } from '@/wagmi';
import { useIsDaoGteV3 } from '@/wrappers/nounsDao';

import classes from './NavBar.module.css';
import navDropdownClasses from './NavBarDropdown.module.css';

import responsiveUiUtilsClasses from '@/utils/ResponsiveUIUtils.module.css';

const NavBar = () => {
  const chainId = defaultChain.id;
  const isDaoGteV3 = useIsDaoGteV3();
  const stateBgColor = useAppSelector(state => state.application.stateBackgroundColor);
  const isCool = useAppSelector(state => state.application.isCoolBackground);
  const currentNounSeed = useAppSelector(state => state.application.currentNounSeed) as INounSeed | null;
  const torchMode = useAppSelector(state => state.application.torchMode);
  const navDispatch = useAppDispatch();
  const location = useLocation();
  const treasuryBalance = useReadNounsTreasuryBalancesInEth({
    query: {
      select: data => {
        console.log(data);
        return data.total;
      },
    },
  }).data;
  const daoEtherscanLink = buildEtherscanAddressLink(nounsTreasuryAddress[chainId]);
  const [isNavExpanded, setIsNavExpanded] = useState(false);

  const useStateBg =
    location.pathname === '/' ||
    location.pathname.includes('/noun/') ||
    location.pathname.includes('/auction/');

  const stateBasedButtonStyle = isCool ? NavBarButtonStyle.COOL_INFO : NavBarButtonStyle.WARM_INFO;

  const nonWalletButtonStyle = !useStateBg ? NavBarButtonStyle.WHITE_INFO : stateBasedButtonStyle;

  const closeNav = () => setIsNavExpanded(false);
  const buttonClasses = usePickByState(
    navDropdownClasses.whiteInfoSelectedBottom,
    navDropdownClasses.coolInfoSelected,
    navDropdownClasses.warmInfoSelected,
  );
  const candidatesNavItem = config.featureToggles.candidates ? (
    <Dropdown.Item className={buttonClasses} href="/vote#candidates">
      <Trans>Candidates</Trans>
    </Dropdown.Item>
  ) : null;

  const v3DaoNavItem = (
    <NavDropdown
      buttonText="DAO"
      buttonIcon={<FontAwesomeIcon icon={faUsers} />}
      buttonStyle={nonWalletButtonStyle}
    >
      <Dropdown.Item
        className={clsx(
          usePickByState(
            navDropdownClasses.whiteInfoSelectedBottom,
            navDropdownClasses.coolInfoSelected,
            navDropdownClasses.warmInfoSelected,
          ),
        )}
        href="/vote"
      >
        <Trans>Proposals</Trans>
      </Dropdown.Item>
      {candidatesNavItem}
    </NavDropdown>
  );

  return (
    <>
      <Navbar
        expand="xl"
        style={{ backgroundColor: `${useStateBg ? stateBgColor : 'white'}` }}
        className={classes.navBarCustom}
        expanded={isNavExpanded}
      >
        <Container style={{ maxWidth: 'unset' }}>
          <div className={classes.brandAndTreasuryWrapper}>
            <Navbar.Brand as={Link} to="/" className={classes.navBarBrand}>
              <NogglesLogo className={classes.navBarLogo} aria-label="Nouns DAO noggles" />
            </Navbar.Brand>
            {Number(CHAIN_ID) !== 1 && (
              <Nav.Item>
                <img className={classes.testnetImg} src={testnetNoun} alt="testnet noun" />
                TESTNET
              </Nav.Item>
            )}
            <Nav.Item>
              {treasuryBalance !== undefined ? (
                <Nav.Link
                  href={daoEtherscanLink}
                  className={classes.nounsNavLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  <NavBarTreasury
                    treasuryBalance={Number(formatEther(treasuryBalance)).toFixed(0)}
                    treasuryStyle={nonWalletButtonStyle}
                  />
                </Nav.Link>
              ) : null}
            </Nav.Item>
            {currentNounSeed && (
              <Nav.Item className="d-none d-xl-flex" style={{ alignItems: 'center', marginLeft: '8px', gap: '6px' }}>
                <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.5, whiteSpace: 'nowrap' }}>
                  today's color pal:
                </span>
                <NounPalette seed={currentNounSeed} />
              </Nav.Item>
            )}
          </div>
          <Navbar.Toggle
            className={classes.navBarToggle}
            aria-controls="basic-navbar-nav"
            onClick={() => setIsNavExpanded(!isNavExpanded)}
          />
          <Navbar.Collapse className="justify-content-end z-10">
            <div className={clsx(responsiveUiUtilsClasses.mobileOnly)}>
              <Nav.Link as={Link} to="/vote" className={classes.nounsNavLink} onClick={closeNav}>
                <NavBarButton
                  buttonText={isDaoGteV3 ? <Trans>Proposals</Trans> : <Trans>DAO</Trans>}
                  buttonIcon={<FontAwesomeIcon icon={faFile} />}
                  buttonStyle={nonWalletButtonStyle}
                />
              </Nav.Link>
              {isDaoGteV3 && (
                <>
                  {config.featureToggles.candidates && (
                    <Nav.Link
                      as={Link}
                      to="/vote#candidates"
                      className={classes.nounsNavLink}
                      onClick={closeNav}
                    >
                      <NavBarButton
                        buttonText={<Trans>Candidates</Trans>}
                        buttonIcon={<FontAwesomeIcon icon={faPenToSquare} />}
                        buttonStyle={nonWalletButtonStyle}
                      />
                    </Nav.Link>
                  )}
                </>
              )}
            </div>
            <div className={clsx(responsiveUiUtilsClasses.desktopOnly)}>
              {isDaoGteV3 ? (
                v3DaoNavItem
              ) : (
                <Nav.Link as={Link} to="/vote" className={classes.nounsNavLink} onClick={closeNav}>
                  <NavBarButton
                    buttonText={<Trans>DAO</Trans>}
                    buttonIcon={<FontAwesomeIcon icon={faUsers} />}
                    buttonStyle={nonWalletButtonStyle}
                  />
                </Nav.Link>
              )}
            </div>
            <div className={clsx(responsiveUiUtilsClasses.mobileOnly)}>
              <Nav.Link
                as={Link}
                to="/playground"
                className={classes.nounsNavLink}
                onClick={closeNav}
              >
                <NavBarButton
                  buttonText={<Trans>Playground</Trans>}
                  buttonIcon={<FontAwesomeIcon icon={faPlay} />}
                  buttonStyle={nonWalletButtonStyle}
                />
              </Nav.Link>
              <Nav.Link
                as={Link}
                to="/nouns"
                className={clsx(classes.nounsNavLink, classes.exploreButton)}
                onClick={closeNav}
              >
                <NavBarButton
                  buttonText={<Trans>Nouns</Trans>}
                  buttonIcon={<NogglesIcon />}
                  buttonStyle={nonWalletButtonStyle}
                />
              </Nav.Link>
              <Nav.Link
                as={Link}
                to="/traits"
                className={clsx(classes.nounsNavLink, classes.exploreButton)}
                onClick={closeNav}
              >
                <NavBarButton
                  buttonText={<Trans>Traits</Trans>}
                  buttonIcon={<NogglesIcon />}
                  buttonStyle={nonWalletButtonStyle}
                />
              </Nav.Link>
              <Nav.Link
                as={Link}
                to="/terminal"
                className={classes.nounsNavLink}
                onClick={closeNav}
              >
                <NavBarButton
                  buttonText="Terminal"
                  buttonIcon={<span>⌐◨-◨</span>}
                  buttonStyle={nonWalletButtonStyle}
                />
              </Nav.Link>
              <Nav.Link
                as={Link}
                to="/feed"
                className={classes.nounsNavLink}
                onClick={closeNav}
              >
                <NavBarButton
                  buttonText="Feed"
                  buttonIcon={<span>📡</span>}
                  buttonStyle={nonWalletButtonStyle}
                />
              </Nav.Link>
              <Nav.Link
                as={Link}
                to="/highway"
                className={classes.nounsNavLink}
                onClick={closeNav}
              >
                <NavBarButton
                  buttonText="Highway"
                  buttonIcon={<span>🛣️</span>}
                  buttonStyle={nonWalletButtonStyle}
                />
              </Nav.Link>
            </div>
            <div className={clsx(responsiveUiUtilsClasses.desktopOnly)}>
              <NavDropdown
                buttonText="Explore"
                buttonIcon={<NogglesIcon />}
                buttonStyle={nonWalletButtonStyle}
              >
                <Dropdown.Item
                  className={clsx(
                    usePickByState(
                      navDropdownClasses.whiteInfoSelectedBottom,
                      navDropdownClasses.coolInfoSelected,
                      navDropdownClasses.warmInfoSelected,
                    ),
                  )}
                  href="/nouns"
                >
                  <Trans>Nouns</Trans>
                </Dropdown.Item>
                <Dropdown.Item
                  className={clsx(
                    usePickByState(
                      navDropdownClasses.whiteInfoSelectedBottom,
                      navDropdownClasses.coolInfoSelected,
                      navDropdownClasses.warmInfoSelected,
                    ),
                  )}
                  href="/traits"
                >
                  <Trans>Traits</Trans>
                </Dropdown.Item>
                <Dropdown.Item
                  className={clsx(
                    usePickByState(
                      navDropdownClasses.whiteInfoSelectedBottom,
                      navDropdownClasses.coolInfoSelected,
                      navDropdownClasses.warmInfoSelected,
                    ),
                  )}
                  href="/playground"
                >
                  Playground
                </Dropdown.Item>
                <Dropdown.Item
                  className={clsx(
                    usePickByState(
                      navDropdownClasses.whiteInfoSelectedBottom,
                      navDropdownClasses.coolInfoSelected,
                      navDropdownClasses.warmInfoSelected,
                    ),
                  )}
                  href="/studio"
                >
                  Studio
                </Dropdown.Item>
                <Dropdown.Item
                  className={clsx(
                    usePickByState(
                      navDropdownClasses.whiteInfoSelectedBottom,
                      navDropdownClasses.coolInfoSelected,
                      navDropdownClasses.warmInfoSelected,
                    ),
                  )}
                  href="/dreams"
                >
                  Dreams
                </Dropdown.Item>
                <Dropdown.Item
                  className={clsx(
                    usePickByState(
                      navDropdownClasses.whiteInfoSelectedBottom,
                      navDropdownClasses.coolInfoSelected,
                      navDropdownClasses.warmInfoSelected,
                    ),
                  )}
                  href="/settlers"
                >
                  Settlers
                </Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item
                  className={clsx(
                    usePickByState(
                      navDropdownClasses.whiteInfoSelectedBottom,
                      navDropdownClasses.coolInfoSelected,
                      navDropdownClasses.warmInfoSelected,
                    ),
                  )}
                  href="/terminal"
                >
                  Terminal
                </Dropdown.Item>
                <Dropdown.Item
                  className={clsx(
                    usePickByState(
                      navDropdownClasses.whiteInfoSelectedBottom,
                      navDropdownClasses.coolInfoSelected,
                      navDropdownClasses.warmInfoSelected,
                    ),
                  )}
                  href="/feed"
                >
                  Feed
                </Dropdown.Item>
                <Dropdown.Item
                  className={clsx(
                    usePickByState(
                      navDropdownClasses.whiteInfoSelectedBottom,
                      navDropdownClasses.coolInfoSelected,
                      navDropdownClasses.warmInfoSelected,
                    ),
                  )}
                  href="/highway"
                >
                  Highway
                </Dropdown.Item>
              </NavDropdown>
            </div>
            <NavLocaleSwitcher buttonStyle={nonWalletButtonStyle} />
            <button
              onClick={() => navDispatch(setTorchMode(!torchMode))}
              title={torchMode ? 'Turn on the lights' : 'Turn off the lights'}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1.2rem',
                padding: '6px 8px',
                lineHeight: 1,
                opacity: 0.7,
                transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; }}
            >
              {torchMode ? '☀️' : '🌙'}
            </button>
            <SubgraphSettings />
            <ConnectKitButton.Custom>
              {({ isConnected, show, address }) => {
                if (!isConnected)
                  return (
                    <NavBarButton
                      buttonText="Connect"
                      buttonStyle={nonWalletButtonStyle}
                      onClick={show}
                    />
                  );
                return (
                  <NavBarButton
                    buttonText={<ShortAddress address={address!} avatar={true} size={24} />}
                    buttonStyle={nonWalletButtonStyle}
                    onClick={show}
                  />
                );
              }}
            </ConnectKitButton.Custom>
          </Navbar.Collapse>
        </Container>
      </Navbar>
    </>
  );
};

export default NavBar;
