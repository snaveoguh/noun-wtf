/**
 * Bootstrap — single entry point that wires permissions + services into BerryOS.
 *
 * We dynamically import the self-registering apps (PermissionsApp, ServicesApp)
 * inside `bootBerrySystems` rather than at module load. This avoids a TDZ
 * cycle: `apps/registry.tsx` is the source of `APP_REGISTRY`, and
 * `berryRegistry.register` mutates that map. Importing the app modules at
 * load time chains back through `berryRegistry` → `APP_REGISTRY` while the
 * registry's own initializer is still running. Deferring to a microtask after
 * mount sidesteps that.
 *
 * `bootBerrySystems` is idempotent — second call (e.g. on `system:bootComplete`)
 * is a no-op.
 */

import { registerBuiltinDaemons } from './daemons';
import { serviceManager } from './services';

let didBoot = false;

export function bootBerrySystems(): void {
  if (didBoot) return;
  didBoot = true;
  // Daemons live in our own module subtree — safe to register synchronously.
  registerBuiltinDaemons();
  // Defer app self-registration to a microtask so `apps/registry.tsx` has
  // already finished its own initializer by the time `berryRegistry` mutates
  // it. Without this, the dynamic import would still be safe (Vite resolves
  // it lazily) but we want a single deterministic boot pathway.
  void Promise.all([
    import('../apps/PermissionsApp'),
    import('../apps/ServicesApp'),
  ]).then(() => {
    void serviceManager.boot();
  });
}
