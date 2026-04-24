import React, { useContext, useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import ProposalCard from './ProposalCard';
import './Proposals.css';

const Proposals = () => {
  const { theme } = useTheme();
  const [graveyardMode] = useState(() => localStorage.getItem('graveyardMode') === 'true');
  const [ghosts, setGhosts] = useState([]);

  useEffect(() => {
    if (graveyardMode) {
      const interval = setInterval(() => {
        setGhosts((prevGhosts) => [
          ...prevGhosts,
          { x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight },
        ]);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [graveyardMode]);

  return (
    <div className={graveyardMode ? 'graveyard-proposals' : 'proposals'}>
      {graveyardMode && (
        <div className="fog"></div>
      )}
      {graveyardMode && ghosts.map((ghost, index) => (
        <div key={index} className="ghost" style={{ left: ghost.x, top: ghost.y }}>●…</div>
      ))}
      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} proposal={proposal} />
      ))}
    </div>
  );
};

export default Proposals;