// Stand-in for packages/nouns-webapp/src/hooks.ts.
//
// World2Page calls `useAppSelector` to default the player's Noun to the
// one currently on auction. The app has no Redux store, so the selector
// always sees an empty state and the page falls back to the saved / random
// seed. Aliased in vite.config.ts + tsconfig.json.

export function useAppSelector<T>(selector: (state: unknown) => T): T {
  return selector({});
}

export function useAppDispatch(): (action: unknown) => void {
  return () => undefined;
}
