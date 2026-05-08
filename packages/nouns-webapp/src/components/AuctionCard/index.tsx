import { useState, useEffect } from 'react';
import { formatAuctionTimeRemaining } from '../../utils/timeUtils';

const AuctionCard: React.FC<AuctionCardProps> = ({ auction }) => {
  const [timeRemaining, setTimeRemaining] = useState<number>(0);

  useEffect(() => {
    const updateTimer = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, auction.endTime - now);
      setTimeRemaining(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [auction.endTime]);

  const { text: timeText, isUrgent } = formatAuctionTimeRemaining(timeRemaining);

  const pulseStyle = isUrgent ? {
    animation: 'pulse 1s infinite',
    '@keyframes pulse': {
      '0%': { opacity: 1 },
      '50%': { opacity: 0.7 },
      '100%': { opacity: 1 }
    }
  } : {};

  return (
    <div className="auction-card">
      {/* existing auction card content */}
      <div 
        className="time-remaining"
        style={{
          ...pulseStyle,
          color: isUrgent ? '#ff4444' : '#666',
          fontWeight: isUrgent ? 'bold' : 'normal'
        }}
      >
        {timeText} remaining
      </div>
      {/* rest of auction card content */}
    </div>
  );
};

export default AuctionCard;