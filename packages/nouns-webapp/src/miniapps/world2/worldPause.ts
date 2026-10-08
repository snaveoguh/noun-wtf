/** Global "game is backgrounded" flag, so stray window key handlers stay quiet. */
let paused = false;

export const worldPause = {
  get: () => paused,
  set: (v: boolean) => {
    paused = v;
  },
};
