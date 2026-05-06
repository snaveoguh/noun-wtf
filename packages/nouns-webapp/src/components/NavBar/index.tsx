import { useEffect } from 'react';

import { faUsers } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useReadNounsTreasuryBalancesInEth } from '@nouns/sdk/react/treasury';
import clsx from 'clsx';
import { ConnectKitButton } from 'connectkit';
import { PencilLine, Wallet } from 'lucide-react';
import { Container, Dropdown, Nav, Navbar } from 'react-bootstrap';
import { Link, useLocation, useNavigate } from 'react-router';
import { formatEther } from 'viem';
import { useBalance } from 'wagmi';

import NogglesIcon from '@/assets/icons/Noggles.svg?react';
import testnetNoun from '@/assets/testnet-noun.png';
import HeaderDaoToggle from '@/components/HeaderDaoToggle';
import LolLogo from '@/components/LolLogo';
import NavBarButton, { NavBarButtonStyle } from '@/components/NavBarButton';
import NavBarTreasury from '@/components/NavBarTreasury';
import NavDropdown from '@/components/NavDropdown';
import NavLocaleSwitcher from '@/components/NavLocaleSwitcher';
import NounPalette from '@/components/NounPalette';
import ShortAddress from '@/components/ShortAddress';
import SubgraphSettings from '@/components/SubgraphSettings';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import config, { CHAIN_ID } from '@/config';
import { useSiteTheme } from '@/contexts/SiteThemeContext';
import { nounsTreasuryAddress } from '@/contracts';
import { NOUNV2_TREASURY_ADDRESS } from '@/contracts/nounv2-treasury';
import { useAppDispatch, useAppSelector } from '@/hooks';
import { useActiveDao } from '@/hooks/useActiveDao';
import { setTorchMode } from '@/state/slices/application';
import { usePickByState } from '@/utils/colorResponsiveUIUtils';
import { buildEtherscanAddressLink } from '@/utils/etherscan';
import { defaultChain } from '@/wagmi';
import { useIsDaoGteV3 } from '@/wrappers/nounsDao';
import { INounSeed } from '@/wrappers/nounToken';

import classes from './NavBar.module.css';
import navDropdownClasses from './NavBarDropdown.module.css';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

// Render a nav-link label with normal-case text on md+ and ALL-CAPS on
// mobile. CSS-driven so we don't need a useMediaQuery hook. Mobile keeps
// the full word (no devoweling) — readability beats compactness here since
// the dropdown is the only place the user sees these labels.
const ResponsiveLabel = ({ text }: { text: string }) => (
  <>
    <span className="d-none d-md-inline">{text}</span>
    <span className="d-inline d-md-none">{text.toUpperCase()}</span>
  </>
);

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
  const { setTheme: setSiteThemeName } = useSiteTheme();
  const { activeDao } = useActiveDao();
  const treasuryBalance = useReadNounsTreasuryBalancesInEth({
    query: {
      select: data => data.total,
    },
  }).data;
  const nounV2TreasuryConfigured = NOUNV2_TREASURY_ADDRESS !== ZERO_ADDRESS;
  const { data: nounV2TreasuryBalance } = useBalance({
    address: NOUNV2_TREASURY_ADDRESS,
    query: { enabled: nounV2TreasuryConfigured },
  });
  const isNounV2 = activeDao === 'nounv2';
  const daoEtherscanLink = buildEtherscanAddressLink(
    isNounV2 && nounV2TreasuryConfigured ? NOUNV2_TREASURY_ADDRESS : nounsTreasuryAddress[chainId],
  );

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
      <ResponsiveLabel text="Candidates" />
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
        <ResponsiveLabel text="Proposals" />
      </Dropdown.Item>
      {candidatesNavItem}
      <Dropdown.Item href="/grants">
        <ResponsiveLabel text="Grants" />
      </Dropdown.Item>
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
            {/* Terminal-feed entry point — squashed next to the fries logo.
                Hidden on mobile (the logo itself is the home tap target there
                — adding a second green button next to it left no way back to
                home from pro on mobile). */}
            <button
              type="button"
              onClick={() => {
                // Quick-jump to Terminal theme — equivalent to picking 🍆 in the
                // theme dropdown on the right.
                setSiteThemeName('terminal');
                navigate('/');
              }}
              title="Switch to Terminal Feed"
              aria-label="Switch to Terminal Feed"
              className="d-none d-md-inline-flex"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#00ff41',
                cursor: 'pointer',
                padding: '2px 4px',
                marginLeft: '4px',
                lineHeight: 1,
                fontSize: '1rem',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontWeight: 700,
                flexShrink: 0,
                alignItems: 'center',
              }}
            >
              &gt;_
            </button>
            {Number(CHAIN_ID) !== 1 && (
              <Nav.Item>
                <img className={classes.testnetImg} src={testnetNoun} alt="testnet noun" />
                TESTNET
              </Nav.Item>
            )}
            <Nav.Item className="d-none d-sm-block">
              {(() => {
                if (isNounV2) {
                  // Hide the nav item entirely when the v2 treasury address isn't configured —
                  // rendering "0 ETH" with a zero-address etherscan link would just look broken.
                  if (!nounV2TreasuryConfigured || nounV2TreasuryBalance === undefined) return null;
                  // Adaptive precision: V2 treasury starts sub-1-ETH so .toFixed(0) reads as "0".
                  // Scale precision down as the balance grows so the format stays readable.
                  const v2EthValue = Number(formatEther(nounV2TreasuryBalance.value));
                  const v2Decimals = v2EthValue >= 100 ? 0 : v2EthValue >= 1 ? 2 : 3;
                  return (
                    <Nav.Link
                      href={daoEtherscanLink}
                      className={classes.nounsNavLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <NavBarTreasury
                        treasuryBalance={v2EthValue.toFixed(v2Decimals)}
                        treasuryStyle={nonWalletButtonStyle}
                      />
                    </Nav.Link>
                  );
                }
                if (treasuryBalance === undefined) return null;
                return (
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
                );
              })()}
            </Nav.Item>
            <Nav.Item className="d-flex" style={{ alignItems: 'center', marginLeft: '8px' }}>
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
            {/* People dropdown (Proposals/Candidates/Grants) — desktop only.
                On mobile its items render at the top of the Noggles dropdown
                so the user only sees a single menu trigger in the header. */}
            <div className="d-none d-md-flex">
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
            </div>
            <NavDropdown
              buttonText=""
              buttonIcon={<NogglesIcon />}
              buttonStyle={nonWalletButtonStyle}
            >
              {/* Mobile-only: governance items merged in from the people
                  dropdown so mobile has a single menu. */}
              <Dropdown.Item href="/vote" className="d-md-none">
                <ResponsiveLabel text="Proposals" />
              </Dropdown.Item>
              {config.featureToggles.candidates && (
                <Dropdown.Item href="/candidates" className="d-md-none">
                  <ResponsiveLabel text="Candidates" />
                </Dropdown.Item>
              )}
              <Dropdown.Item href="/grants" className="d-md-none">
                <ResponsiveLabel text="Grants" />
              </Dropdown.Item>
              <Dropdown.Divider className="d-md-none" />
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
                <ResponsiveLabel text="Probe" />
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
                <ResponsiveLabel text="Traits" />
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
                <ResponsiveLabel text="Playground" />
              </Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item href="/marketplace">
                <ResponsiveLabel text="Marketplace" />
              </Dropdown.Item>
              <Dropdown.Item href="/predictions">
                <ResponsiveLabel text="Predictions" />
              </Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item href="/dashboard">
                <ResponsiveLabel text="Dashboard" />
              </Dropdown.Item>
              <Dropdown.Item href="/gas">
                <ResponsiveLabel text="Gas" />
              </Dropdown.Item>
              <Dropdown.Item href="/crystal-ball">
                <ResponsiveLabel text="Crystal Ball" />
              </Dropdown.Item>
              <Dropdown.Item href="/feed">
                <ResponsiveLabel text="Feed" />
              </Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Item href="/hackathons">
                <ResponsiveLabel text="Hack" />
              </Dropdown.Item>
              <Dropdown.Item href="/world">
                <ResponsiveLabel text="World" />
              </Dropdown.Item>
              <Dropdown.Item href="/nonsense">
                <ResponsiveLabel text="Nonsense" />
              </Dropdown.Item>
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
              <SubgraphSettings />
            </div>
            <ConnectKitButton.Custom>
              {({ isConnected, show, address }) => {
                if (!isConnected)
                  return (
                    <NavBarButton
                      // Mobile shows a wallet icon to save horizontal space
                      // (the V1/V2 toggle + two action icon buttons + connect
                      // were previously overflowing the mobile header). Desktop
                      // keeps the original "Connect" text label.
                      buttonText={
                        <>
                          <span className="d-none d-md-inline">Connect</span>
                          <span
                            className="d-inline-flex d-md-none"
                            style={{ alignItems: 'center' }}
                            aria-label="Connect wallet"
                          >
                            <Wallet size={16} />
                          </span>
                        </>
                      }
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
            <div style={{ display: 'flex', alignItems: 'center', marginLeft: '8px' }}>
              <ThemeSwitcher
                variant="navbar"
                onChange={next => {
                  // Picking Terminal needs a navigate('/') so AppRouter swaps in
                  // TerminalFeedShell on the next render. Other themes already
                  // render through the standard chrome.
                  if (next === 'terminal') {
                    navigate('/');
                  }
                }}
              />
            </div>
          </div>
        </Container>
      </Navbar>
    </>
  );
};

export default NavBar;
