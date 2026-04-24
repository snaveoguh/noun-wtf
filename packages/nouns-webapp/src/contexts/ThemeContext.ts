import { createContext, useState } from 'react';

interface ThemeContextProps {
  children: React.ReactNode;
}

const ThemeContext = createContext({ theme: 'classic', setTheme: () => {} });

const ThemeProvider = ({ children }: ThemeContextProps) => {
  const [theme, setTheme] = useState('classic');

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export { ThemeContext, ThemeProvider };