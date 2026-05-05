import { useSyncExternalStore } from 'react';

export interface MiniWindowState {
  id: string;
  title: string;
  content: React.ReactNode;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface OpenMiniWindowOptions {
  /** Used to dedupe — if a window with this id is already open, focus it instead of opening a new one. */
  id?: string;
  title: string;
  content: React.ReactNode;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
}

interface State {
  windows: MiniWindowState[];
  nextZ: number;
  nextId: number;
}

type Listener = () => void;

const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 680;

let state: State = { windows: [], nextZ: 1000, nextId: 1 };
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function setState(next: State) {
  state = next;
  emit();
}

function defaultPosition(width: number, height: number): { x: number; y: number } {
  if (typeof window === 'undefined') return { x: 80, y: 80 };
  const x = Math.max(16, Math.round((window.innerWidth - width) / 2));
  const y = Math.max(16, Math.round((window.innerHeight - height) / 3));
  return { x, y };
}

export const miniWindowStore = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot(): MiniWindowState[] {
    return state.windows;
  },
  open(opts: OpenMiniWindowOptions): string {
    const id = opts.id ?? `mw-${state.nextId}`;
    const existing = state.windows.find(w => w.id === id);
    if (existing) {
      // Re-focus, swap content (in case caller passed fresh props), and bring to front.
      const next = state.nextZ + 1;
      setState({
        ...state,
        nextZ: next,
        windows: state.windows.map(w =>
          w.id === id ? { ...w, content: opts.content, title: opts.title, zIndex: next } : w,
        ),
      });
      return id;
    }
    const width = opts.width ?? DEFAULT_WIDTH;
    const height = opts.height ?? DEFAULT_HEIGHT;
    const pos = opts.x !== undefined && opts.y !== undefined
      ? { x: opts.x, y: opts.y }
      : defaultPosition(width, height);
    const win: MiniWindowState = {
      id,
      title: opts.title,
      content: opts.content,
      x: pos.x,
      y: pos.y,
      width,
      height,
      zIndex: state.nextZ + 1,
    };
    setState({
      windows: [...state.windows, win],
      nextZ: state.nextZ + 1,
      nextId: opts.id ? state.nextId : state.nextId + 1,
    });
    return id;
  },
  close(id: string) {
    setState({ ...state, windows: state.windows.filter(w => w.id !== id) });
  },
  focus(id: string) {
    if (state.windows[state.windows.length - 1]?.id === id) return; // already focused
    const next = state.nextZ + 1;
    setState({
      ...state,
      nextZ: next,
      windows: state.windows.map(w => (w.id === id ? { ...w, zIndex: next } : w)),
    });
  },
  move(id: string, x: number, y: number) {
    setState({
      ...state,
      windows: state.windows.map(w => (w.id === id ? { ...w, x, y } : w)),
    });
  },
};

export function useMiniWindows(): MiniWindowState[] {
  return useSyncExternalStore(miniWindowStore.subscribe, miniWindowStore.getSnapshot);
}
