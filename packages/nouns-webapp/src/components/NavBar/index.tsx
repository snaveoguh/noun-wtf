import { useEffect, useState } from 'react';

import { faFile, faPenToSquare, faPlay, faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Trans } from '@lingui/react/macro';
import { useReadNounsTreasuryBalancesInEth } from '@nouns/sdk/react/treasury';
import clsx from 'clsx';
import { ConnectKitButton } from 'connectkit';
import { Container, Dropdown, Nav, Navbar } from 'react-bootstrap';
import { Link, useLocation, useNavigate } from 'react-router';
import { formatEther } from 'viem';

import NogglesIcon from '@/assets/icons/Noggles.svg?react';
import testnetNoun from '@/assets/testnet-noun.png';
import LolLogo from '@/components/LolLogo';
import NavBarButton, { NavBarButtonStyle } from '@/components/NavBarButton';
import NavBarTreasury from '@/components/NavBarTreasury';
import NavDropdown from '@/components/NavDropdown';
import NavLocaleSwitcher from '@/components/NavLocaleSwitcher';
import NounPalette from '@/components/NounPalette';
import ShortAddress from '@/components/ShortAddress';
import SubgraphSettings from '@/components/SubgraphSettings';
import config, { CHAIN_ID } from '@/config';
import { useSiteTheme } from '@/contexts/SiteThemeContext';
import { nounsTreasuryAddress } from '@/contracts';
import { useAppDispatch, useAppSelector } from '@/hooks';
import { setTorchMode } from '@/state/slices/application';
import { usePickByState } from '@/utils/colorResponsiveUIUtils';
import { buildEtherscanAddressLink } from '@/utils/etherscan';
import { defaultChain } from '@/wagmi';
import { useIsDaoGteV3 } from '@/wrappers/nounsDao';
import { INounSeed } from '@/wrappers/nounToken';

import classes from './NavBar.module.css';
import navDropdownClasses from './NavBarDropdown.module.css';

import responsiveUiUtilsClasses from '@/utils/ResponsiveUIUtils.module.css';

const NavBar = () => {
  const chainId = defaultChain.id;
  const isDaoGteV3 = useIsDaoGteV3();
  const isCool = useAppSelector(state => state.application.isCoolBackground);
  const currentNounSeed = useAppSelector(
    state => state.application.currentNounSeed,
  ) as INounSeed | null;
  const stateBgColor = useAppSelector(state => state.application.stateBackgroundColor);
  const torchMode = useAppSelector(state => state.application.torchMode);
  const navDispatch = useAppDispatch();
  const location = useLocation();
  const navigate = useNavigate();
  const { setMode: setSiteMode } = useSiteTheme();
  const treasuryBalance = useReadNounsTreasuryBalancesInEth({
    query: {
      select: data => data.total,
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
    <Dropdown.Item className={buttonClasses} href="/candidates">
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
      <Dropdown.Item href="/grants">Grants</Dropdown.Item>
    </NavDropdown>
  );

  useEffect(() => {
    const previousBodyBackground = document.body.style.backgroundColor;

    if (useStateBg) {
      document.body.style.backgroundColor = stateBgColor;
    }

    if (!useStateBg) {
      document.body.style.backgroundColor = '';
    }

    return () => {
      document.body.style.backgroundColor = previousBodyBackground;
    };
  }, [stateBgColor, useStateBg]);

  return (
    <>
      <Navbar
        expand="lg"
        style={{ backgroundColor: 'transparent' }}
        className={classes.navBarCustom}
        expanded={isNavExpanded}
      >
        <Container fluid className={classes.navBarInner}>
          <div className={classes.brandAndTreasuryWrapper}>
            <Navbar.Brand as={Link} to="/" className={classes.navBarBrand}>
              <LolLogo className={classes.navBarLogo} />
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
              <Nav.Item
                className="d-none d-lg-flex"
                style={{ alignItems: 'center', marginLeft: '8px', gap: '6px' }}
              >
                <span
                  style={{
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    opacity: 0.5,
                    whiteSpace: 'nowrap',
                  }}
                >
                  color 2day:
                </span>
                <NounPalette seed={currentNounSeed} />
              </Nav.Item>
            )}
          </div>
          <button
            type="button"
            className={classes.makeArtHeaderBtn}
            onClick={() => window.dispatchEvent(new CustomEvent('noun-make-art'))}
          >
            MAKE ART
          </button>
          <Navbar.Toggle
            className={classes.navBarToggle}
            aria-controls="basic-navbar-nav"
            onClick={() => setIsNavExpanded(!isNavExpanded)}
          />
          <Navbar.Collapse className="justify-content-end z-10" style={{ visibility: 'visible' }}>
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
                      to="/candidates"
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
              <Nav.Link as={Link} to="/grants" className={classes.nounsNavLink} onClick={closeNav}>
                <NavBarButton
                  buttonText="Grants"
                  buttonIcon={<FontAwesomeIcon icon={faFile} />}
                  buttonStyle={nonWalletButtonStyle}
                />
              </Nav.Link>
              <Nav.Link
                as={Link}
                to="/hackathons"
                className={classes.nounsNavLink}
                onClick={closeNav}
              >
                <NavBarButton
                  buttonText="Hack"
                  buttonIcon={<span>⚡</span>}
                  buttonStyle={nonWalletButtonStyle}
                />
              </Nav.Link>
              <Nav.Link as={Link} to="/world" className={classes.nounsNavLink} onClick={closeNav}>
                <NavBarButton
                  buttonText="World"
                  buttonIcon={<span>🌍</span>}
                  buttonStyle={nonWalletButtonStyle}
                />
              </Nav.Link>
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
                to="/crystal-ball"
                className={classes.nounsNavLink}
                onClick={closeNav}
              >
                <NavBarButton
                  buttonText="Crystal Ball"
                  buttonIcon={<span>🔮</span>}
                  buttonStyle={nonWalletButtonStyle}
                />
              </Nav.Link>
              <Nav.Link as={Link} to="/feed" className={classes.nounsNavLink} onClick={closeNav}>
                <NavBarButton
                  buttonText="Feed"
                  buttonIcon={<span>📡</span>}
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
                <Dropdown.Divider />
                <Dropdown.Item href="/terminal">Terminal</Dropdown.Item>
                <Dropdown.Item href="/crystal-ball">Crystal Ball</Dropdown.Item>
                <Dropdown.Item href="/feed">Feed</Dropdown.Item>
                <Dropdown.Divider />
                <Dropdown.Item href="/hackathons">Hack</Dropdown.Item>
                <Dropdown.Item href="/world">World</Dropdown.Item>
                <Dropdown.Item href="/nonsense">Nonsense</Dropdown.Item>
              </NavDropdown>
            </div>
            <NavLocaleSwitcher buttonStyle={nonWalletButtonStyle} />
            <button
              type="button"
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
              onMouseEnter={e => {
                e.currentTarget.style.opacity = '1';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.opacity = '0.7';
              }}
            >
              {torchMode ? '☀️' : '🌙'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSiteMode('new');
                navigate('/');
              }}
              title="Switch to Terminal Feed"
              style={{
                background: 'none',
                border: '1px solid rgba(0,255,65,0.3)',
                cursor: 'pointer',
                fontSize: '0.65rem',
                padding: '3px 8px',
                lineHeight: 1,
                color: '#00ff41',
                borderRadius: '3px',
                letterSpacing: '0.5px',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(0,255,65,0.1)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'none';
              }}
            >
              NEW
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
