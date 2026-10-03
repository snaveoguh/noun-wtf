import React, { useState } from 'react';

import { Trans } from '@lingui/react/macro';

import {
  ProposalActionCreationStep,
  ProposalActionModalStepProps,
  ProposalActionType,
} from '../..';
import BrandDropdown from '../../../BrandDropdown';
import ModalBottomButtonRow from '../../../ModalBottomButtonRow';
import ModalSubTitle from '../../../ModalSubtitle';
import ModalTitle from '../../../ModalTitle';

const proposalActionTypeToProposalActionCreationStep = (actionTypeString: string) => {
  if (actionTypeString === ProposalActionType.LUMP_SUM.toString()) {
    return ProposalActionCreationStep.LUMP_SUM_DETAILS;
  } else if (actionTypeString === ProposalActionType.STREAM.toString()) {
    return ProposalActionCreationStep.STREAM_PAYMENT_PAYMENT_DETAILS;
  } else {
    return ProposalActionCreationStep.FUNCTION_CALL_SELECT_FUNCTION;
  }
};

const SelectProposalActionStep: React.FC<ProposalActionModalStepProps> = props => {
  const { onPrevBtnClick, onNextBtnClick, state, setState, dao } = props;
  const isLil = dao === 'lil-nouns';

  const [nextStep, setNextStep] = useState<ProposalActionCreationStep>(
    proposalActionTypeToProposalActionCreationStep(state.actionType?.toString() ?? ''),
  );

  return (
    <div>
      <ModalTitle>
        <Trans>Add Proposal Action</Trans>
      </ModalTitle>

      {isLil ? (
        // Untranslated like the rest of the Lil Nouns draft copy.
        <ModalSubTitle>
          <hr />
          <b>Lil Nouns DAO</b>
          <hr />
          Actions execute from the Lil Nouns treasury. Request a currency it actually holds: live
          treasury balances are shown on the next step.
          <hr />
          <b>Supported Action Types</b>
          <hr />
          <b>• Transfer Funds: </b>Send USDC, stETH, ETH, or WETH.
          <br />
          <b>• Function Call: </b>Call a contract function.
        </ModalSubTitle>
      ) : (
        <ModalSubTitle>
          <Trans>
            <hr />
            <b>Guidelines</b>
            <hr />• Do <b>NOT</b> request ETH to trade into USDC. Instead, request USDC directly.
            <br />• Do <b>NOT</b> transfer funds externally to create an ETH or USDC stream.
            Instead, use the &quot;Stream Funds&quot; action.
            <hr />
            <b>Supported Action Types</b>
            <hr />
            <b>• Transfer Funds: </b>Send USDC, ETH, or stETH.
            <br />
            <b>• Stream Funds: </b>Stream USDC or WETH over time.
            <br />
            <b>• Function Call: </b>Call a contract function.
          </Trans>
        </ModalSubTitle>
      )}

      <BrandDropdown
        value={state.actionType.toString()}
        onChange={e => {
          const actionType = Object.entries(ProposalActionType).find(entry => {
            return entry[1] === e.target.value;
          });

          setState(x => ({
            ...x,
            actionType: actionType ? actionType[1] : ProposalActionType.LUMP_SUM,
          }));

          setNextStep(proposalActionTypeToProposalActionCreationStep(e.target.value));
        }}
      >
        <option value={'Transfer Funds'}>Transfer Funds</option>
        {!isLil && <option value={'Stream Funds'}>Stream Funds</option>}
        <option value={'Function Call'}>Function Call</option>
      </BrandDropdown>

      <ModalBottomButtonRow
        prevBtnText={<Trans>Close</Trans>}
        onPrevBtnClick={onPrevBtnClick}
        nextBtnText={<Trans>Add Action Details</Trans>}
        onNextBtnClick={() => {
          onNextBtnClick(nextStep);
        }}
      />
    </div>
  );
};

export default SelectProposalActionStep;
