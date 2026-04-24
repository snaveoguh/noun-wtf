import React from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import Proposals from './components/Proposals';

const App = () => {
  return (
    <ThemeProvider>
      <Proposals />
    </ThemeProvider>
  );
};

export default App;