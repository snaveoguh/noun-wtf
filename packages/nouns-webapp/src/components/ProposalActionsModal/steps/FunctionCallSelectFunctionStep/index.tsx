import type { Address } from '@/utils/types';
import type { AbiFunction } from 'viem';

import React, { ChangeEvent, useEffect, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { Abi, isAddress } from 'viem';

import ABIUpload from '@/components/ABIUpload';
import BrandDropdown from '@/components/BrandDropdown';
import BrandTextEntry from '@/components/BrandTextEntry';
import ModalBottomButtonRow from '@/components/ModalBottomButtonRow';
import ModalTitle from '@/components/ModalTitle';
import { ETHERSCAN_API_KEY } from '@/config';
import { getKnownContract } from '@/lib/knownAbis';
import { buildEtherscanApiQuery } from '@/utils/etherscan';

import { ProposalActionModalStepProps } from '../..';

import 'bs-custom-file-input';
import 'react-stepz/dist/index.css';

const FunctionCallSelectFunctionStep: React.FC<ProposalActionModalStepProps> = props => {
  const { onNextBtnClick, onPrevBtnClick, state, setState } = props;

  const [address, setAddress] = useState<Address>(state.address ?? ('' as Address));
  const [abi, setABI] = useState<Abi>();
  const [value, setValue] = useState(state.amount ? state.amount.toString() : '');
  const [func, setFunction] = useState(state.function ?? '');

  const [isABIUploadValid, setABIUploadValid] = useState<boolean>();
  const [abiFileName, setABIFileName] = useState<string | undefined>('');
  // Why the dropdown is empty, when it is — the Etherscan lookup used to fail silently.
  const [abiLookupError, setABILookupError] = useState<string | null>(null);
  const [isValidForNextStage, setIsValidForNextStage] = useState(false);

  useEffect(() => {
    if (state.abi) {
      setABI(state.abi);
      setABIFileName('etherscan-abi-download.json');
    }

    if (state.address.length > 0 && isAddress(state.address) && state.abi && !isValidForNextStage) {
      setIsValidForNextStage(true);
    }
  }, [isValidForNextStage, state]);

  useEffect(() => {
    if (
      address.length > 0 &&
      isAddress(address) &&
      isABIUploadValid === true &&
      !isValidForNextStage
    ) {
      setIsValidForNextStage(true);
    }
  }, [address, isABIUploadValid, isValidForNextStage]);

  useEffect(() => {
    if (abi) {
      // Find first function in the ABI
      const functions = (abi as Abi).filter(
        item => item.type === 'function' && item.name.length > 0,
      ) as AbiFunction[];

      if (functions.length > 0) {
        setFunction(functions[0].name);
      }
    }
  }, [abi]);

  let abiErrorTimeout: NodeJS.Timeout | undefined;
  const setABIInvalid = () => {
    setABIUploadValid(false);
    setABIFileName(undefined);
    abiErrorTimeout = setTimeout(() => {
      setABIUploadValid(undefined);
    }, 5_000);
  };

  const validateAndSetABI = (file: File | undefined) => {
    if (abiErrorTimeout !== undefined) {
      clearTimeout(abiErrorTimeout);
    }
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const abiString = e?.target?.result?.toString() ?? '';
        const parsedAbi = JSON.parse(abiString);
        // Handle both raw ABI array and ABI wrapped in 'abi' property
        const abiArray = Array.isArray(parsedAbi) ? parsedAbi : parsedAbi.abi;

        setABI(abiArray as Abi);
        setABIUploadValid(true);
        setABIFileName(file.name);
      } catch {
        setABIInvalid();
      }
    };
    reader.readAsText(file);
  };

  const getContractInformation = async (address: string) => {
    const response = await fetch(buildEtherscanApiQuery(address));
    const json = await response.json();
    return json?.result?.[0];
  };

  const getABI = async (address: string) => {
    let info = await getContractInformation(address);
    if (info?.Proxy === '1' && isAddress(info?.Implementation)) {
      info = await getContractInformation(info.Implementation);
    }
    return info.ABI;
  };

  const populateABIIfExists = async (address: string) => {
    if (abiErrorTimeout !== undefined) {
      clearTimeout(abiErrorTimeout);
    }

    setABILookupError(null);
    // Nouns contracts ship their ABIs with the app — no Etherscan round-trip,
    // no API key needed, works offline. Everything else falls through below.
    const known = getKnownContract(address);
    if (known !== undefined) {
      setABI(known.abi);
      setABIUploadValid(true);
      setABIFileName(`built-in: ${known.name}`);
      return;
    }
    try {
      const result = await getABI(address);
      const parsedAbi = JSON.parse(result);
      setABI(parsedAbi as Abi);
      setABIUploadValid(true);
      setABIFileName('etherscan-abi-download.json');
    } catch {
      setABIUploadValid(undefined);
      setABIFileName(undefined);
      setABILookupError(
        ETHERSCAN_API_KEY === ''
          ? "No Etherscan API key is configured on this deployment, so the ABI can't be fetched automatically. Upload the contract ABI below."
          : "Couldn't fetch this contract's ABI from Etherscan (unverified contract, rate limit, or network). Upload the ABI below.",
      );
    }
  };
  const addressValidator = (s: string) => {
    if (!isAddress(s)) {
      return false;
    }
    // To avoid blocking stepper progress, do not `await`
    populateABIIfExists(s);
    return true;
  };

  return (
    <div>
      <ModalTitle>
        <Trans>Add Function Call Arguments</Trans>
      </ModalTitle>

      <BrandTextEntry
        label={'Contract Address'}
        onChange={e => {
          setAddress(e.target.value as Address);
          addressValidator(e.target.value);
        }}
        value={address}
        type="string"
        min="0"
        placeholder="0x..."
      />

      <BrandTextEntry
        label={'Included ETH (optional)'}
        onChange={e => setValue(e.target.value)}
        value={value}
        type="number"
        placeholder="0"
      />

      <BrandDropdown
        value={func}
        onChange={e => setFunction(e.target.value)}
        label={'Select Contract Function'}
        chevronTop={35}
      >
        {abi === undefined && (
          <option value="" disabled>
            {abiLookupError === null
              ? 'Enter a contract address to load its functions'
              : 'No ABI loaded'}
          </option>
        )}
        {abi !== undefined &&
          (abi as Abi)
            .filter(item => item.type === 'function' && item.name.length > 0)
            .map(item => (
              <option key={(item as AbiFunction).name} value={(item as AbiFunction).name}>
                {(item as AbiFunction).name}
              </option>
            ))}
      </BrandDropdown>
      {abiLookupError !== null && abi === undefined && (
        <p style={{ margin: '-8px 0 12px', fontSize: 13, lineHeight: 1.4, opacity: 0.85 }}>
          {abiLookupError}
        </p>
      )}

      <ABIUpload
        abiFileName={abiFileName}
        isValid={isABIUploadValid}
        isInvalid={isABIUploadValid === false}
        onChange={(e: ChangeEvent<HTMLInputElement>) => validateAndSetABI(e.target.files?.[0])}
      />

      <ModalBottomButtonRow
        isNextBtnDisabled={!isValidForNextStage}
        prevBtnText={<Trans>Back</Trans>}
        onPrevBtnClick={onPrevBtnClick}
        nextBtnText={<Trans>Add Arguments</Trans>}
        onNextBtnClick={() => {
          setState(x => ({
            ...x,
            abi,
            amount: value,
            address,
            function: func,
          }));
          onNextBtnClick();
        }}
      />
    </div>
  );
};

export default FunctionCallSelectFunctionStep;
