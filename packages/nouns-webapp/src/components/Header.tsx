import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Button } from './Button';

const Header = () => {
  const { theme, setTheme } = useTheme();
  const [graveyardMode, setGraveyardMode] = useState(() => localStorage.getItem('graveyardMode') === 'true');

  const toggleGraveyardMode = () => {
    setGraveyardMode(!graveyardMode);
    localStorage.setItem('graveyardMode', !graveyardMode ? 'true' : 'false');
  };

  return (
    <div className="header">
      <Button onClick={() => setTheme('classic')}>Classic</Button>
      <Button onClick={toggleGraveyardMode}>Graveyard</Button>
    </div>
  );
};

export default Header;