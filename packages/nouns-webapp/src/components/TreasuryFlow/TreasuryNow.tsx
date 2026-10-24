// TREASURY NOW — what the DAO holds today (live chain read from the API),
// valued in ETH at on-chain rates, with USDC kept in dollars.
import type { TreasuryHoldings } from './types';

import { etherscanAddr, etherscanToken, fmtDate, fmtEth, fmtToken, fmtUsd, shareOf } from './model';
import Tip from './Tip';

const TOKEN_TIP: Record<string, string> = {
  ETH: 'Plain ether.',
  WETH: 'Wrapped ETH: worth exactly 1 ETH.',
  stETH:
    'Lido staked ETH: 1 stETH = 1 ETH, and the balance grows by itself as staking rewards come in.',
  wstETH:
    'Wrapped stETH: each one is worth more stETH over time. Valued at Lido’s stEthPerToken() rate.',
  rETH: 'Rocket Pool staked ETH: rises in value against ETH. Valued at its getExchangeRate().',
  mETH: 'Mantle staked ETH: rises in value against ETH. Valued at the Mantle staking contract’s mETHToETH().',
  USDC: 'Dollars (a stablecoin). Kept in $ and never added to the ETH total.',
  ENS: 'ENS governance tokens. Not valued here.',
};

const rateLabel = (rate: number | null, symbol: string) =>
  rate === null || rate === 1 ? '' : `1 ${symbol} = ${rate.toFixed(4)} ETH`;

export default function TreasuryNow({ h }: { h: TreasuryHoldings }) {
  const priceNote =
    h.ethUsd !== null && h.usdInEth !== null
      ? `about ${fmtEth(h.usdInEth)} at $${Math.round(h.ethUsd).toLocaleString('en-US')} per ETH (Chainlink)`
      : null;
  return (
    <section className="nz-card nz-now" aria-label="treasury now">
      <h2 className="nz-h" data-keep-font>
        TREASURY NOW
      </h2>
      <div className="nz-now-hero">
        <div>
          <span className="nz-now-v">{fmtEth(h.totalEth)}</span>
          <span className="nz-now-k">
            ETH-equivalent{' '}
            <Tip text="ETH plus staked ETH (stETH, wstETH, rETH, mETH) across nouns.eth and the DAO's other contracts, with each staked token converted at its own on-chain rate. Dollars are not added in." />
          </span>
        </div>
        <div>
          <span className="nz-now-v is-usd">+ {fmtUsd(h.totalUsd)}</span>
          <span className="nz-now-k">
            in USDC{' '}
            <Tip
              text={`Dollar stablecoins, kept in $ so ETH and dollars are never mixed.${priceNote !== null ? ` For scale: ${priceNote}.` : ''}`}
            />
          </span>
        </div>
      </div>
      <p className="nz-muted">
        read live from the chain{h.block !== null ? ` at block ${h.block.toLocaleString()}` : ''},{' '}
        {fmtDate(h.at)}
        {!h.complete && ' · some reads failed, so these totals are a floor'}
      </p>

      <div className="nz-holders">
        {h.holders.map(holder => (
          <div key={holder.address} className="nz-holder">
            <div className="nz-holder-head">
              <a href={etherscanAddr(holder.address)} target="_blank" rel="noreferrer">
                {holder.name}
              </a>
              <Tip text={holder.description} />
              <span className="nz-holder-sum">
                {holder.holdings.length === 0
                  ? 'empty'
                  : [
                      holder.eth > 0 ? fmtEth(holder.eth) : '',
                      holder.usd > 0 ? fmtUsd(holder.usd) : '',
                    ]
                      .filter(Boolean)
                      .join(' + ')}
              </span>
            </div>
            {holder.holdings.length > 0 && (
              <table className="nz-table nz-hold-table">
                <thead>
                  <tr>
                    <th>token</th>
                    <th className="num">amount</th>
                    <th className="num">≈ ETH</th>
                    <th className="hide-sm">share of ETH total</th>
                  </tr>
                </thead>
                <tbody>
                  {holder.holdings.map(x => {
                    const share = shareOf(x.eth, h.totalEth);
                    return (
                      <tr key={x.symbol}>
                        <td>
                          {x.token !== null ? (
                            <a
                              href={etherscanToken(x.token, holder.address)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {x.symbol}
                            </a>
                          ) : (
                            x.symbol
                          )}{' '}
                          <Tip
                            text={TOKEN_TIP[x.symbol] ?? 'A token the DAO holds. Not valued here.'}
                          />
                          {x.eth !== null && (
                            <span className="nz-row-meta show-sm">
                              <span className="nz-share">
                                <b style={{ width: `${share * 100}%` }} />
                              </span>
                            </span>
                          )}
                        </td>
                        <td className="num">
                          {fmtToken(x.amount, x.symbol)}
                          {rateLabel(x.rate, x.symbol) !== '' && (
                            <small className="nz-rate">{rateLabel(x.rate, x.symbol)}</small>
                          )}
                        </td>
                        <td className="num">
                          {x.eth !== null ? (
                            fmtEth(x.eth)
                          ) : (
                            <span className="nz-muted">{x.usd !== null ? 'in $' : '—'}</span>
                          )}
                        </td>
                        <td className="hide-sm nz-share-cell">
                          {x.eth !== null && (
                            <>
                              <span className="nz-share">
                                <b style={{ width: `${share * 100}%` }} />
                              </span>
                              <span className="nz-share-pct">
                                {(share * 100).toFixed(share < 0.01 ? 2 : 1)}%
                              </span>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
