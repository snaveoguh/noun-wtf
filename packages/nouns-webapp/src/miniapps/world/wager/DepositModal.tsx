// ── Deposit Modal — Connect wallet, approve, deposit into TreasureChest ──

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { parseUnits, type Address } from 'viem';

import { useDepositETH, useDepositERC20, useDepositERC721, usePendingDeposits, hasContract } from './treasureChest';

interface DepositModalProps {
  open: boolean;
  onClose: () => void;
}

export function DepositModal({ open, onClose }: DepositModalProps) {
  const { isConnected } = useAccount();
  const pendingCount = usePendingDeposits();

  const [tab, setTab] = useState<'eth' | 'erc20' | 'nft'>('eth');
  const [ethAmount, setEthAmount] = useState('0.01');
  const [tokenAddress, setTokenAddress] = useState('');
  const [tokenAmount, setTokenAmount] = useState('');
  const [nftAddress, setNftAddress] = useState('');
  const [nftTokenId, setNftTokenId] = useState('');

  const ethDeposit = useDepositETH();
  const erc20Deposit = useDepositERC20();
  const nftDeposit = useDepositERC721();

  if (!open) return null;

  const modalStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0,0,0,0.7)',
    pointerEvents: 'auto',
  };

  const boxStyle: React.CSSProperties = {
    background: '#1a1a2e',
    borderRadius: 12,
    padding: 24,
    width: 380,
    maxWidth: '90vw',
    color: '#fff',
    fontFamily: 'monospace',
    border: '1px solid rgba(218,165,32,0.3)',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid #444',
    background: '#111',
    color: '#fff',
    fontFamily: 'monospace',
    fontSize: 14,
    marginBottom: 8,
  };

  const btnStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 16px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontWeight: 'bold',
    fontSize: 14,
  };

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 16px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 12,
    background: active ? '#DAA520' : '#333',
    color: active ? '#000' : '#aaa',
  });

  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={boxStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#DAA520' }}>Treasure Chest</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 20 }}>x</button>
        </div>

        <p style={{ color: '#888', fontSize: 12, marginBottom: 16 }}>
          Deposit tokens into the chest. At settlement time, items scatter across the island for players to claim.
          {Number(pendingCount) > 0 && (
            <span style={{ color: '#DAA520' }}> {Number(pendingCount)} items waiting for next drop!</span>
          )}
        </p>

        {!hasContract && (
          <p style={{ color: '#ff6b6b', fontSize: 12, textAlign: 'center', padding: 16 }}>
            Contract not deployed yet. Coming soon!
          </p>
        )}

        {!isConnected ? (
          <p style={{ textAlign: 'center', color: '#888', padding: 20 }}>
            Connect your wallet to deposit
          </p>
        ) : (
          <>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button style={tabBtnStyle(tab === 'eth')} onClick={() => setTab('eth')}>ETH</button>
              <button style={tabBtnStyle(tab === 'erc20')} onClick={() => setTab('erc20')}>ERC20</button>
              <button style={tabBtnStyle(tab === 'nft')} onClick={() => setTab('nft')}>NFT</button>
            </div>

            {/* ETH Tab */}
            {tab === 'eth' && (
              <>
                <label style={{ fontSize: 11, color: '#888' }}>Amount (ETH)</label>
                <input
                  type="text"
                  value={ethAmount}
                  onChange={e => setEthAmount(e.target.value)}
                  placeholder="0.01"
                  style={inputStyle}
                />
                <button
                  style={{ ...btnStyle, background: '#627eea', color: '#fff' }}
                  onClick={() => ethDeposit.deposit(ethAmount)}
                  disabled={ethDeposit.isPending || !hasContract}
                >
                  {ethDeposit.isPending ? 'Depositing...' : `Deposit ${ethAmount} ETH`}
                </button>
                {ethDeposit.isSuccess && (
                  <p style={{ color: '#4ecdc4', fontSize: 12, marginTop: 8, textAlign: 'center' }}>Deposited!</p>
                )}
              </>
            )}

            {/* ERC20 Tab */}
            {tab === 'erc20' && (
              <>
                <label style={{ fontSize: 11, color: '#888' }}>Token Address</label>
                <input
                  type="text"
                  value={tokenAddress}
                  onChange={e => setTokenAddress(e.target.value)}
                  placeholder="0x..."
                  style={inputStyle}
                />
                <label style={{ fontSize: 11, color: '#888' }}>Amount</label>
                <input
                  type="text"
                  value={tokenAmount}
                  onChange={e => setTokenAmount(e.target.value)}
                  placeholder="100"
                  style={inputStyle}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    style={{ ...btnStyle, background: '#444', color: '#fff', flex: 1 }}
                    onClick={() => erc20Deposit.approve(tokenAddress as Address, parseUnits(tokenAmount || '0', 18))}
                    disabled={erc20Deposit.approvePending || !hasContract}
                  >
                    {erc20Deposit.approvePending ? 'Approving...' : '1. Approve'}
                  </button>
                  <button
                    style={{ ...btnStyle, background: '#4ecdc4', color: '#000', flex: 1 }}
                    onClick={() => erc20Deposit.deposit(tokenAddress as Address, parseUnits(tokenAmount || '0', 18))}
                    disabled={erc20Deposit.isPending || !hasContract}
                  >
                    {erc20Deposit.isPending ? 'Depositing...' : '2. Deposit'}
                  </button>
                </div>
              </>
            )}

            {/* NFT Tab */}
            {tab === 'nft' && (
              <>
                <label style={{ fontSize: 11, color: '#888' }}>NFT Contract Address</label>
                <input
                  type="text"
                  value={nftAddress}
                  onChange={e => setNftAddress(e.target.value)}
                  placeholder="0x..."
                  style={inputStyle}
                />
                <label style={{ fontSize: 11, color: '#888' }}>Token ID</label>
                <input
                  type="text"
                  value={nftTokenId}
                  onChange={e => setNftTokenId(e.target.value)}
                  placeholder="42"
                  style={inputStyle}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    style={{ ...btnStyle, background: '#444', color: '#fff', flex: 1 }}
                    onClick={() => nftDeposit.approve(nftAddress as Address, BigInt(nftTokenId || '0'))}
                    disabled={nftDeposit.approvePending || !hasContract}
                  >
                    {nftDeposit.approvePending ? 'Approving...' : '1. Approve'}
                  </button>
                  <button
                    style={{ ...btnStyle, background: '#ff6b6b', color: '#fff', flex: 1 }}
                    onClick={() => nftDeposit.deposit(nftAddress as Address, BigInt(nftTokenId || '0'))}
                    disabled={nftDeposit.isPending || !hasContract}
                  >
                    {nftDeposit.isPending ? 'Depositing...' : '2. Deposit'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
