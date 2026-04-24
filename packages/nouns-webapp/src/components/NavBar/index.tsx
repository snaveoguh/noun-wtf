import { useEffect } from 'react';

import { faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Trans } from '@lingui/react/macro';
import { useReadNounsTreasuryBalancesInEth } from '@nouns/sdk/react/treasury';
import clsx from 'clsx';
import { ConnectKitButton } from 'connectkit';
import { PencilLine } from 'lucide-react';
import { Container, Dropdown, Nav, Navbar } from 'react-bootstrap';
import { Link, useLocation, useNavigate } from 'react-router';
import { formatEther } from 'viem';

import NogglesIcon from '@/assets/icons/Noggles.svg?react';
import testnetNoun from '@/assets/testnet-noun.png';
import LolLogo from '@/components/LolLogo';
import HeaderDaoToggle from '@/components/HeaderDaoToggle';
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

  const useStateBg =
    location.pathname === '/' ||
    location.pathname.includes('/noun/') ||
    location.pathname.includes('/auction/');

  const stateBasedButtonStyle = isCool ? NavBarButtonStyle.COOL_INFO : NavBarButtonStyle.WARM_INFO;

  const nonWalletButtonStyle = !useStateBg ? NavBarButtonStyle.WHITE_INFO : stateBasedButtonStyle;

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
      buttonText=""
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
      <Navbar expand style={{ backgroundColor: 'transparent' }} className={classes.navBarCustom}>
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
            <Nav.Item className="d-none d-sm-block">
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
            <Nav.Item
              className="d-flex"
              style={{ alignItems: 'center', marginLeft: '8px' }}
            >
              <HeaderDaoToggle />
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
            onClick={() => {
              if (location.pathname === '/' || location.pathname.startsWith('/noun/')) {
                window.dispatchEvent(new CustomEvent('noun-make-art'));
              } else {
                navigate('/?makeArt=1');
              }
            }}
          >
            <PencilLine size={18} />
          </button>
          <div className={clsx('justify-content-end', classes.navBarItems)}>
            {isDaoGteV3 ? (
              v3DaoNavItem
            ) : (
              <Nav.Link as={Link} to="/vote" className={classes.nounsNavLink}>
                <NavBarButton
                  buttonText=""
                  buttonIcon={<FontAwesomeIcon icon={faUsers} />}
                  buttonStyle={nonWalletButtonStyle}
                />
              </Nav.Link>
            )}
            <NavDropdown
              buttonText=""
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
                href="/probe"
              >
                Probe
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
              <Dropdown.Item href="/marketplace">Marketplace</Dropdown.Item>
              <Dropdown.Item href="/predictions">Predictions</Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item href="/dashboard">Dashboard</Dropdown.Item>
              <Dropdown.Item href="/gas">Gas</Dropdown.Item>
              <Dropdown.Item href="/terminal">Terminal</Dropdown.Item>
              <Dropdown.Item href="/crystal-ball">Crystal Ball</Dropdown.Item>
              <Dropdown.Item href="/feed">Feed</Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item href="/hackathons">Hack</Dropdown.Item>
              <Dropdown.Item href="/world">World</Dropdown.Item>
              <Dropdown.Item href="/nonsense">Nonsense</Dropdown.Item>
            </NavDropdown>
            <div className={classes.navBarSecondary}>
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
            </div>
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
                    buttonText={
                      <ShortAddress address={address!} avatar={true} size={28} avatarOnly />
                    }
                    buttonStyle={nonWalletButtonStyle}
                    onClick={show}
                  />
                );
              }}
            </ConnectKitButton.Custom>
          </div>
        </Container>
      </Navbar>
    </>
  );
};

export default NavBar;
