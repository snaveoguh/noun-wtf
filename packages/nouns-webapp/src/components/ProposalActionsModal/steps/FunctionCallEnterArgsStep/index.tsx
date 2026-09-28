import type { ProposalActionModalStepProps } from '@/components/ProposalActionsModal';
import type { Abi, AbiFunction } from 'viem';

import React, { useEffect, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { Col, FormControl, FormGroup, InputGroup, Row } from 'react-bootstrap';
import { encodeFunctionData, getAbiItem } from 'viem';

import 'bs-custom-file-input';
import 'react-stepz/dist/index.css';

import ModalBottomButtonRow from '@/components/ModalBottomButtonRow';
import ModalTitle from '@/components/ModalTitle';

import classes from './FunctionCallEnterArgsStep.module.css';

/**
 * Convert the typed-in strings to what viem's encoder expects for each ABI
 * input type. This used to JSON-parse only tuples/arrays and hand everything
 * else over as a raw string — viem rejects a string for `bool`, so any
 * function with a boolean argument (e.g. setClientApproval(uint32,bool))
 * could never be encoded and the Next button stayed disabled with no
 * visible reason.
 */
const parseArguments = (abi: Abi | undefined, func: string, args: string[]) => {
  const abiItem = abi ? (getAbiItem({ abi, name: func }) as AbiFunction) : undefined;
  return args.map((a, i) => {
    const type = abiItem?.inputs?.[i]?.type ?? '';
    const v = a.trim();
    if (type === 'tuple' || type.endsWith(']')) return JSON.parse(v);
    if (type === 'bool') {
      const lc = v.toLowerCase();
      if (lc === 'true' || lc === '1' || lc === 'yes') return true;
      if (lc === 'false' || lc === '0' || lc === 'no') return false;
      throw new Error(`Invalid boolean: ${a}`);
    }
    if (/^u?int\d*$/.test(type)) return BigInt(v);
    return v;
  });
};

const FunctionCallEnterArgsStep: React.FC<ProposalActionModalStepProps> = props => {
  const { onNextBtnClick, onPrevBtnClick, state, setState } = props;

  const abi = state.abi;
  const func = state.function ?? '';

  const [args, setArguments] = useState<string[]>([]);
  const [isValidForNextStage, setIsValidForNextStage] = useState(false);
  const [invalidArgument, setInvalidArgument] = useState(false);

  // Re-validate on every change. Validity is recomputed rather than latched:
  // the old version set it true once and never back, and a sibling effect
  // cleared the "invalid" flag in the same tick, so the warning never showed.
  useEffect(() => {
    if (func === '' || abi === undefined) {
      setIsValidForNextStage(true);
      setInvalidArgument(false);
      return;
    }
    const abiItem = getAbiItem({ abi, name: func }) as AbiFunction | undefined;
    const inputs = abiItem?.inputs ?? [];
    if (inputs.length === 0) {
      setIsValidForNextStage(true);
      setInvalidArgument(false);
      return;
    }
    const filled = inputs.every((_, i) => (args[i] ?? '').trim() !== '');
    if (!filled) {
      // Nothing to complain about until every field has something in it.
      setIsValidForNextStage(false);
      setInvalidArgument(false);
      return;
    }
    try {
      encodeFunctionData({
        abi: [abiItem as AbiFunction],
        functionName: func,
        args: parseArguments(abi, func, args),
      });
      setIsValidForNextStage(true);
      setInvalidArgument(false);
    } catch {
      setIsValidForNextStage(false);
      setInvalidArgument(true);
    }
  }, [abi, args, func]);

  const setArgument = (index: number, value: string) => {
    const values = [...args];
    values[index] = value;
    setArguments(values);
  };

  const getAbiInputs = () => {
    if (abi === undefined || func === '') return [];
    const abiItem = getAbiItem({ abi, name: func }) as AbiFunction;
    return abiItem?.inputs ?? [];
  };

  const inputs = getAbiInputs();

  return (
    <div>
      <ModalTitle>
        <Trans>Add Function Call Arguments</Trans>
      </ModalTitle>

      {invalidArgument && (
        <div className={classes.invalid}>
          <Trans>Invalid Arguments</Trans>
        </div>
      )}
      {inputs.length ? (
        // @ts-expect-error TS2590: react-bootstrap FormGroup union type too complex
        <FormGroup as={Row}>
          {inputs.map((input, i) => (
            <React.Fragment key={i}>
              <span className={classes.label}>{input.name}</span>
              <Col sm="12">
                <InputGroup className="mb-1">
                  <InputGroup.Text className={classes.inputGroupText}>{input.type}</InputGroup.Text>
                  <FormControl
                    className={classes.inputGroup}
                    value={args[i] ?? ''}
                    onChange={e => setArgument(i, e.target.value)}
                  />
                </InputGroup>
              </Col>
            </React.Fragment>
          ))}
        </FormGroup>
      ) : (
        <Trans>No arguments required </Trans>
      )}

      <ModalBottomButtonRow
        prevBtnText={<Trans>Back</Trans>}
        onPrevBtnClick={onPrevBtnClick}
        nextBtnText={<Trans>Review and Add</Trans>}
        isNextBtnDisabled={inputs.length ? !isValidForNextStage : false}
        onNextBtnClick={() => {
          setState(x => ({
            ...x,
            args: parseArguments(abi, func, args),
          }));
          onNextBtnClick();
        }}
      />
    </div>
  );
};

export default FunctionCallEnterArgsStep;
