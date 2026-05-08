export const formatAuctionTimeRemaining = (timeRemaining: number): { text: string; isUrgent: boolean } => {
  const hours = Math.floor(timeRemaining / 3600);
  const minutes = Math.floor((timeRemaining % 3600) / 60);
  const seconds = timeRemaining % 60;

  const isUrgent = timeRemaining < 30;
  
  if (timeRemaining < 60) {
    // Show seconds for final minute
    if (hours > 0) {
      return { text: `${hours}h ${minutes}m ${seconds}s`, isUrgent };
    } else if (minutes > 0) {
      return { text: `${minutes}m ${seconds}s`, isUrgent };
    } else {
      return { text: `${seconds}s`, isUrgent };
    }
  }
  
  // Standard format for longer durations
  if (hours > 0) {
    return { text: `${hours}h ${minutes}m`, isUrgent };
  } else {
    return { text: `${minutes}m`, isUrgent };
  }
};