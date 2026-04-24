import React, { useContext } from 'react';
import { useTheme } from '../contexts/ThemeContext';

const ProposalCard = ({ proposal }: any) => {
  const { theme } = useTheme();
  const [graveyardMode] = useState(() => localStorage.getItem('graveyardMode') === 'true');

  if (graveyardMode) {
    return (
      <div className="graveyard-proposal-card">
        <pre>{`_______
|       |
|  ${proposal.title}  |
|       |
|_______|`}</pre>
        {proposal.status === 'failed' && <span className="cracked">CRACKED</span>}
        {proposal.status === 'cancelled' && <span className="tilted">TILTED</span>}
      </div>
    );
  }

  return (
    <div className="proposal-card">
      <h2>{proposal.title}</h2>
      <p>{proposal.description}</p>
    </div>
  );
};

export default ProposalCard;