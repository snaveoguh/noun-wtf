import { Address, BigNumberish } from '@/utils/types';

export interface Auction {
  amount?: BigNumberish;
  bidder?: Address;
  endTime: BigNumberish;
  startTime: BigNumberish;
  nounId: BigNumberish;
  settled: boolean;
  clientId?: number | null;
  /**
   * Reserve-not-met settlement: the AuctionSettled event fired with
   * winner=0x0 and amount=0, which causes the NounsAuctionHouse contract to
   * burn the noun (see `_settleAuction` in NounsAuctionHouseV2). When true,
   * the webapp renders a burned-placeholder instead of a normal result row.
   */
  burned?: boolean;
}
