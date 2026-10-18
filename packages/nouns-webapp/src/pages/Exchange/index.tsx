// /exchange: Noun Trade's Grand Exchange, standalone for now (it opens in a
// NounOS window like every page). Later it also opens from the city's
// exchange building in Noun World. `?offline=1` runs it all in this tab.

import ExchangeFloor from '@/miniapps/exchange/ui/ExchangeFloor';

export default function ExchangePage() {
  return <ExchangeFloor />;
}
