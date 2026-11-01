import type { AgentRole, Policy } from '../contract';

import { collector } from './collector';
import { marketMaker } from './marketMaker';
import { shopkeeper } from './shopkeeper';

export const POLICIES: Record<AgentRole, Policy> = {
  shopkeeper,
  maker: marketMaker,
  collector,
};
