import type { DraftDao } from '@/components/GameShell/draftDao';
import type { Abi } from 'viem';

import React, { SetStateAction, useState } from 'react';

import { Address } from '@/utils/types';
import { ProposalTransaction } from '@/wrappers/nounsDao';

import SolidColorBackgroundModal from '../SolidColorBackgroundModal';

import FunctionCallEnterArgsStep from './steps/FunctionCallEnterArgsStep';
import FunctionCallReviewStep from './steps/FunctionCallReviewStep';
import FunctionCallSelectFunctionStep from './steps/FunctionCallSelectFunctionStep';
import SelectProposalActionStep from './steps/SelectProposalActionStep';
import StreamPaymentDateDetailsStep from './steps/StreamPaymentsDateDetailsStep';
import StreamPaymentsPaymentDetailsStep from './steps/StreamPaymentsPaymentDetailsStep';
import StreamPaymentsReviewStep from './steps/StreamPaymentsReviewStep';
import TransferFundsDetailsStep, { SupportedCurrency } from './steps/TransferFundsDetailsStep';
import TransferFundsReviewStep from './steps/TransferFundsReviewStep';

export enum ProposalActionCreationStep {
  SELECT_ACTION_TYPE,
  LUMP_SUM_DETAILS,
  LUMP_SUM_REVIEW,
  FUNCTION_CALL_SELECT_FUNCTION,
  FUNCTION_CALL_ADD_ARGUMENTS,
  FUNCTION_CALL_REVIEW,
  STREAM_PAYMENT_PAYMENT_DETAILS,
  STREAM_PAYMENT_DATE_DETAILS,
  STREAM_PAYMENT_REVIEW,
}

export enum ProposalActionType {
  LUMP_SUM = 'Transfer Funds',
  STREAM = 'Stream Funds',
  FUNCTION_CALL = 'Function Call',
}

export interface ProposalActionModalState {
  actionType: ProposalActionType;
  address: Address;
  amount?: string;
  TransferFundsCurrency?: SupportedCurrency;
  streamStartTimestamp?: number;
  streamEndTimestamp?: number;
  function?: string;
  abi?: Abi;
  args?: string[];
}
export interface ProposalActionModalStepProps {
  onPrevBtnClick: (e?: React.MouseEvent | ProposalActionCreationStep) => void;
  onNextBtnClick: (e?: React.MouseEvent | ProposalActionCreationStep | ProposalTransaction) => void;
  state: ProposalActionModalState;
  setState: (e: SetStateAction<ProposalActionModalState>) => void;
  /**
   * Governor the action is for. Lil Nouns can't use the Nouns payer / stream
   * factory / stETH contracts, so its drafts only offer ETH transfers and
   * function calls.
   */
  dao?: DraftDao;
}

export interface FinalProposalActionStepProps extends ProposalActionModalStepProps {
  onDismiss: () => void;
}

export interface ProposalActionModalProps {
  onActionAdd: (transaction: ProposalTransaction) => void;
  show: boolean;
  onDismiss: () => void;
  dao?: DraftDao;
}

const ModalContent: React.FC<{
  onActionAdd: (transaction: ProposalTransaction) => void;
  onDismiss: () => void;
  dao?: DraftDao;
}> = props => {
  const { onActionAdd, onDismiss, dao } = props;

  const [step, setStep] = useState<ProposalActionCreationStep>(
    ProposalActionCreationStep.SELECT_ACTION_TYPE,
  );

  const [state, setState] = useState<ProposalActionModalState>({
    actionType: ProposalActionType.LUMP_SUM,
    address: '0x',
  });

  switch (step) {
    case ProposalActionCreationStep.SELECT_ACTION_TYPE:
      return (
        <SelectProposalActionStep
          onNextBtnClick={(
            e?: React.MouseEvent | ProposalActionCreationStep | ProposalTransaction,
          ) => {
            if (e !== undefined && typeof e !== 'object') {
              setStep(e);
            }
          }}
          onPrevBtnClick={onDismiss}
          state={state}
          setState={setState}
          dao={dao}
        />
      );
    case ProposalActionCreationStep.LUMP_SUM_DETAILS:
      return (
        <TransferFundsDetailsStep
          onNextBtnClick={() => setStep(ProposalActionCreationStep.LUMP_SUM_REVIEW)}
          onPrevBtnClick={() => setStep(ProposalActionCreationStep.SELECT_ACTION_TYPE)}
          state={state}
          setState={setState}
          dao={dao}
        />
      );
    case ProposalActionCreationStep.LUMP_SUM_REVIEW:
      return (
        <TransferFundsReviewStep
          dao={dao}
          onNextBtnClick={e => {
            if (e !== undefined && typeof e !== 'object') {
              return;
            }
            if (e !== undefined && 'target' in e) {
              return;
            }
            onActionAdd(e as ProposalTransaction);
          }}
          onPrevBtnClick={() => setStep(ProposalActionCreationStep.LUMP_SUM_DETAILS)}
          state={state}
          setState={setState}
          onDismiss={onDismiss}
        />
      );
    case ProposalActionCreationStep.FUNCTION_CALL_SELECT_FUNCTION:
      return (
        <FunctionCallSelectFunctionStep
          onNextBtnClick={() => setStep(ProposalActionCreationStep.FUNCTION_CALL_ADD_ARGUMENTS)}
          onPrevBtnClick={() => setStep(ProposalActionCreationStep.SELECT_ACTION_TYPE)}
          state={state}
          setState={setState}
        />
      );
    case ProposalActionCreationStep.FUNCTION_CALL_ADD_ARGUMENTS:
      return (
        <FunctionCallEnterArgsStep
          onNextBtnClick={() => setStep(ProposalActionCreationStep.FUNCTION_CALL_REVIEW)}
          onPrevBtnClick={() => setStep(ProposalActionCreationStep.FUNCTION_CALL_SELECT_FUNCTION)}
          state={state}
          setState={setState}
        />
      );
    case ProposalActionCreationStep.FUNCTION_CALL_REVIEW:
      return (
        <FunctionCallReviewStep
          onNextBtnClick={e => {
            if (e !== undefined && typeof e !== 'object') {
              return;
            }
            if (e !== undefined && 'target' in e) {
              return;
            }
            onActionAdd(e as ProposalTransaction);
          }}
          onPrevBtnClick={() => setStep(ProposalActionCreationStep.FUNCTION_CALL_ADD_ARGUMENTS)}
          state={state}
          setState={setState}
          onDismiss={onDismiss}
        />
      );
    case ProposalActionCreationStep.STREAM_PAYMENT_PAYMENT_DETAILS:
      return (
        <StreamPaymentsPaymentDetailsStep
          onNextBtnClick={() => setStep(ProposalActionCreationStep.STREAM_PAYMENT_DATE_DETAILS)}
          onPrevBtnClick={() => setStep(ProposalActionCreationStep.SELECT_ACTION_TYPE)}
          state={state}
          setState={setState}
        />
      );
    case ProposalActionCreationStep.STREAM_PAYMENT_DATE_DETAILS:
      return (
        <StreamPaymentDateDetailsStep
          onNextBtnClick={() => setStep(ProposalActionCreationStep.STREAM_PAYMENT_REVIEW)}
          onPrevBtnClick={() => setStep(ProposalActionCreationStep.STREAM_PAYMENT_PAYMENT_DETAILS)}
          state={state}
          setState={setState}
        />
      );
    case ProposalActionCreationStep.STREAM_PAYMENT_REVIEW:
      return (
        <StreamPaymentsReviewStep
          onNextBtnClick={e => {
            if (e !== undefined && typeof e !== 'object') {
              return;
            }
            if (e !== undefined && 'target' in e) {
              return;
            }
            onActionAdd(e as ProposalTransaction);
          }}
          onPrevBtnClick={() => setStep(ProposalActionCreationStep.STREAM_PAYMENT_DATE_DETAILS)}
          state={state}
          setState={setState}
          onDismiss={onDismiss}
        />
      );
    default:
      return (
        <SelectProposalActionStep
          onNextBtnClick={() => console.log('')}
          onPrevBtnClick={() => console.log('')}
          state={state}
          setState={setState}
        />
      );
  }
};

const ProposalActionModal: React.FC<ProposalActionModalProps> = props => {
  const { onActionAdd, show, onDismiss, dao } = props;

  return (
    <SolidColorBackgroundModal
      show={show}
      onDismiss={onDismiss}
      content={
        <>
          {dao === 'lil-nouns' && (
            <div
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                border: '1px solid #f5c542',
                borderRadius: 3,
                background: 'rgba(245, 197, 66, 0.12)',
                fontSize: 13,
              }}
            >
              <strong>Lil Nouns DAO</strong> · this action executes from the Lil Nouns treasury
            </div>
          )}
          <ModalContent onActionAdd={onActionAdd} onDismiss={onDismiss} dao={dao} />
        </>
      }
    />
  );
};

export default ProposalActionModal;
