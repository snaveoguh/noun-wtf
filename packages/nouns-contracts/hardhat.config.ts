/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { HardhatUserConfig } from 'hardhat/config';
import dotenv from 'dotenv';
import '@nomiclabs/hardhat-waffle';
import '@nomicfoundation/hardhat-verify';
import 'solidity-coverage';
import '@typechain/hardhat';
import 'hardhat-abi-exporter';
import '@openzeppelin/hardhat-upgrades';
import 'hardhat-gas-reporter';
import './tasks';

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.23',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    mainnet: {
      url: process.env.RPC_MAINNET || 'https://lb.drpc.live/ethereum/AlfRFwajKElBm1qg1hPw82xliZK6IWsR8aVjdg7bSgwO',
      accounts: [process.env.WALLET_PRIVATE_KEY!].filter(Boolean),
    },
    sepolia: {
      url: process.env.RPC_SEPOLIA || 'https://ethereum-sepolia-rpc.publicnode.com',
      accounts: process.env.MNEMONIC
        ? { mnemonic: process.env.MNEMONIC }
        : [process.env.WALLET_PRIVATE_KEY!].filter(Boolean),
    },
    hardhat: {
      initialBaseFeePerGas: 0,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  abiExporter: {
    path: './abi',
    clear: true,
  },
  typechain: {
    outDir: './typechain',
  },
  gasReporter: {
    enabled: !process.env.CI,
    currency: 'USD',
    gasPrice: 50,
    src: 'contracts',
    coinmarketcap: '7643dfc7-a58f-46af-8314-2db32bdd18ba',
  },
  mocha: {
    timeout: 60_000,
  },
};
export default config;
