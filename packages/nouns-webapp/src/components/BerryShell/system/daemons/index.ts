/**
 * Daemon barrel — imported once for side-effects to register every built-in
 * service with the manager. Importing this module triggers registration but
 * does NOT start anything; serviceManager.boot() handles autoStart.
 *
 * If you ship a new daemon, add it here so it shows up in the Services app.
 */

import { serviceManager } from '../services';

import { auctionWatcherDaemon } from './auctionWatcherDaemon';
import { timeDaemon } from './timeDaemon';
import { walletDaemon } from './walletDaemon';

let registered = false;

export function registerBuiltinDaemons(): void {
  if (registered) return;
  registered = true;
  serviceManager.register(timeDaemon);
  serviceManager.register(walletDaemon);
  serviceManager.register(auctionWatcherDaemon);
}

export { auctionWatcherDaemon, timeDaemon, walletDaemon };
