import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { grey } from '@/utils/nounBgColors';

interface NounSeed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

interface ApplicationState {
  stateBackgroundColor: string;
  isCoolBackground: boolean;
  currentNounSeed: NounSeed | null;
  torchMode: boolean;
}

// Default to torch mode OFF — users can enable via navbar candle icon
const savedTorch = typeof window !== 'undefined' ? localStorage.getItem('noun-wtf-torch') : null;
const torchDefault = savedTorch === '1';

const initialState: ApplicationState = {
  stateBackgroundColor: grey,
  isCoolBackground: true,
  currentNounSeed: null,
  torchMode: torchDefault,
};

export const applicationSlice = createSlice({
  name: 'application',
  initialState,
  reducers: {
    setStateBackgroundColor: (state, action: PayloadAction<string>) => {
      state.stateBackgroundColor = action.payload;
      state.isCoolBackground = action.payload === grey;
    },
    setCurrentNounSeed: (state, action: PayloadAction<NounSeed | null>) => {
      state.currentNounSeed = action.payload;
    },
    setTorchMode: (state, action: PayloadAction<boolean>) => {
      state.torchMode = action.payload;
      try { localStorage.setItem('noun-wtf-torch', action.payload ? '1' : '0'); } catch { /* noop */ }
    },
  },
});

export const { setStateBackgroundColor, setCurrentNounSeed, setTorchMode } = applicationSlice.actions;

export default applicationSlice.reducer;
