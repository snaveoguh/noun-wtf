import { Link } from 'react-router';

import classes from './GameShell.module.css';
import GameShell from './index';
import ProposalDraftPanel from './ProposalDraftPanel';

/**
 * Game-themed Create Proposal page. Wraps `ProposalDraftPanel` in the
 * dashboard chrome (back arrow + page heading) and the GameShell sticky nav.
 *
 * The panel itself is host-agnostic and is also mounted as a draggable
 * mini-window over the terminal feed (NounIRL agent-draft flow).
 */
export default function GameCreateProposal() {
  return (
    <GameShell>
      <div className={classes.propBackBar}>
        <Link to="/vote" aria-label="Back to governance" className={classes.propBackBtn}>
          ←
        </Link>
        <h1 className={classes.propHeading}>Create Proposal</h1>
      </div>
      <ProposalDraftPanel />
    </GameShell>
  );
}
