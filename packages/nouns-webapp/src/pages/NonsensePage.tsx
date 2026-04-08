import React, { Suspense, useEffect } from 'react';

const TreasuryFlowSection = React.lazy(() => import('@/components/TreasuryFlow'));

export default function NonsensePage() {
  // Apply dark theme to navbar while on this page
  useEffect(() => {
    document.body.classList.add('nonsense-dark');
    return () => document.body.classList.remove('nonsense-dark');
  }, []);

  return (
    <>
      <style>{`
        /* ── Page background ── */
        .nonsense-dark {
          background: #0a0a0f !important;
        }

        /* ── NOC ticker banner ── */
        .nonsense-dark > div:first-child {
          background: #0a0a0f !important;
          border-color: rgba(255,255,255,0.08) !important;
        }
        .nonsense-dark > div:first-child * {
          color: #aaa !important;
          border-color: rgba(255,255,255,0.06) !important;
        }
        .nonsense-dark > div:first-child div[style*="linear-gradient"] {
          background: linear-gradient(90deg, #0a0a0f 70%, transparent 100%) !important;
        }

        /* ── Navbar ── */
        .nonsense-dark nav,
        .nonsense-dark [class*="navBarBrand"],
        .nonsense-dark [class*="NavBar_nav"],
        .nonsense-dark .navbar {
          background: #0a0a0f !important;
          border-bottom: 1px solid rgba(255,255,255,0.06) !important;
        }
        .nonsense-dark nav *,
        .nonsense-dark .navbar * {
          color: #e2e8f0 !important;
        }
        .nonsense-dark nav svg,
        .nonsense-dark nav svg path {
          fill: #e2e8f0 !important;
        }

        /* ── ALL nav elements: buttons, treasury, dropdowns ── */
        .nonsense-dark [class*="whiteInfo"],
        .nonsense-dark [class*="coolInfo"],
        .nonsense-dark [class*="warmInfo"],
        .nonsense-dark [class*="wrapper"][class*="Treasury"],
        .nonsense-dark [class*="NavBar"] [class*="wrapper"],
        .nonsense-dark [class*="NavDropdown"] [class*="wrapper"],
        .nonsense-dark nav button,
        .nonsense-dark .navbar button {
          background: rgba(255,255,255,0.06) !important;
          background-color: rgba(255,255,255,0.06) !important;
          border-color: rgba(255,255,255,0.12) !important;
          color: #e2e8f0 !important;
        }
        .nonsense-dark [class*="whiteInfo"]:hover,
        .nonsense-dark [class*="coolInfo"]:hover,
        .nonsense-dark [class*="warmInfo"]:hover,
        .nonsense-dark nav button:hover {
          background: rgba(255,255,255,0.12) !important;
          background-color: rgba(255,255,255,0.12) !important;
        }

        /* ── Dropdown menus ── */
        .nonsense-dark .dropdown-menu,
        .nonsense-dark [class*="NavDropdown_menu"] {
          background: #111122 !important;
          background-color: #111122 !important;
          border: 1px solid rgba(255,255,255,0.12) !important;
          z-index: 9999 !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.8) !important;
        }
        .nonsense-dark .dropdown-menu a,
        .nonsense-dark [class*="NavDropdown_menu"] a,
        .nonsense-dark .dropdown-item {
          color: #e2e8f0 !important;
          background: transparent !important;
          background-color: transparent !important;
          border-color: rgba(255,255,255,0.08) !important;
        }
        .nonsense-dark .dropdown-menu a:hover,
        .nonsense-dark [class*="NavDropdown_menu"] a:hover,
        .nonsense-dark .dropdown-item:hover,
        .nonsense-dark .dropdown-item:focus {
          background: rgba(255,255,255,0.08) !important;
          background-color: rgba(255,255,255,0.08) !important;
          color: #fff !important;
        }
      `}</style>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          top: 110,
          background: '#0a0a0f',
          overflow: 'hidden',
        }}
      >
        <Suspense
          fallback={
            <div
              style={{
                color: '#444',
                textAlign: 'center',
                padding: '60px',
                fontFamily: 'monospace',
              }}
            >
              Loading...
            </div>
          }
        >
          <TreasuryFlowSection />
        </Suspense>
      </div>
    </>
  );
}
