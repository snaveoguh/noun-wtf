import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AuctionNavigation from './index';

// Mock the hooks used in the component
vi.mock('@/hooks', () => ({
  useAppSelector: () => '#d5d7e1', // Mock isCool to be true
}));

// useDaoContext -> useActiveDao reads the current pathname to work out which DAO is active.
vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: '/' }),
  useNavigate: () => vi.fn(),
}));

vi.mock('../../wrappers/onDisplayAuction', () => ({
  __esModule: true,
  default: () => ({
    nounId: {
      toNumber: () => 5,
    },
  }),
}));

describe('AuctionNavigation Component', () => {
  it('renders navigation buttons correctly', () => {
    render(
      <AuctionNavigation
        isFirstAuction={false}
        isLastAuction={false}
        onPrevAuctionClick={vi.fn()}
        onNextAuctionClick={vi.fn()}
      />,
    );

    const prevButton = screen.getAllByRole('button')[0];
    const nextButton = screen.getAllByRole('button')[1];

    expect(prevButton).toBeInTheDocument();
    expect(nextButton).toBeInTheDocument();
    expect(prevButton).not.toBeDisabled();
    expect(nextButton).not.toBeDisabled();
  });

  it('disables previous button when at first auction', () => {
    render(
      <AuctionNavigation
        isFirstAuction={true}
        isLastAuction={false}
        onPrevAuctionClick={vi.fn()}
        onNextAuctionClick={vi.fn()}
      />,
    );

    const prevButton = screen.getAllByRole('button')[0];
    expect(prevButton).toBeDisabled();
  });

  it('disables next button when at last auction', () => {
    render(
      <AuctionNavigation
        isFirstAuction={false}
        isLastAuction={true}
        onPrevAuctionClick={vi.fn()}
        onNextAuctionClick={vi.fn()}
      />,
    );

    const nextButton = screen.getAllByRole('button')[1];
    expect(nextButton).toBeDisabled();
  });

  it('calls onPrevAuctionClick when left arrow button is clicked', () => {
    const onPrevAuctionClick = vi.fn();
    render(
      <AuctionNavigation
        isFirstAuction={false}
        isLastAuction={false}
        onPrevAuctionClick={onPrevAuctionClick}
        onNextAuctionClick={vi.fn()}
      />,
    );

    const prevButton = screen.getAllByRole('button')[0];
    fireEvent.click(prevButton);

    expect(onPrevAuctionClick).toHaveBeenCalledTimes(1);
  });

  it('calls onNextAuctionClick when right arrow button is clicked', () => {
    const onNextAuctionClick = vi.fn();
    render(
      <AuctionNavigation
        isFirstAuction={false}
        isLastAuction={false}
        onPrevAuctionClick={vi.fn()}
        onNextAuctionClick={onNextAuctionClick}
      />,
    );

    const nextButton = screen.getAllByRole('button')[1];
    fireEvent.click(nextButton);

    expect(onNextAuctionClick).toHaveBeenCalledTimes(1);
  });

  it('calls onPrevAuctionClick when left arrow key is pressed', () => {
    const onPrevAuctionClick = vi.fn();
    render(
      <AuctionNavigation
        isFirstAuction={false}
        isLastAuction={false}
        onPrevAuctionClick={onPrevAuctionClick}
        onNextAuctionClick={vi.fn()}
      />,
    );

    // Simulate pressing the left arrow key
    fireEvent.keyDown(document, { key: 'ArrowLeft' });

    expect(onPrevAuctionClick).toHaveBeenCalledTimes(1);
  });

  it('calls onNextAuctionClick when right arrow key is pressed', () => {
    const onNextAuctionClick = vi.fn();
    render(
      <AuctionNavigation
        isFirstAuction={false}
        isLastAuction={false}
        onPrevAuctionClick={vi.fn()}
        onNextAuctionClick={onNextAuctionClick}
      />,
    );

    // Simulate pressing the right arrow key
    fireEvent.keyDown(document, { key: 'ArrowRight' });

    expect(onNextAuctionClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onPrevAuctionClick when left arrow key is pressed and isFirstAuction is true', () => {
    const onPrevAuctionClick = vi.fn();
    render(
      <AuctionNavigation
        isFirstAuction={true}
        isLastAuction={false}
        onPrevAuctionClick={onPrevAuctionClick}
        onNextAuctionClick={vi.fn()}
      />,
    );

    // Simulate pressing the left arrow key
    fireEvent.keyDown(document, { key: 'ArrowLeft' });

    expect(onPrevAuctionClick).not.toHaveBeenCalled();
  });

  it('does not call onNextAuctionClick when right arrow key is pressed and isLastAuction is true', () => {
    const onNextAuctionClick = vi.fn();
    render(
      <AuctionNavigation
        isFirstAuction={false}
        isLastAuction={true}
        onPrevAuctionClick={vi.fn()}
        onNextAuctionClick={onNextAuctionClick}
      />,
    );

    // Simulate pressing the right arrow key
    fireEvent.keyDown(document, { key: 'ArrowRight' });

    expect(onNextAuctionClick).not.toHaveBeenCalled();
  });

  it('applies correct CSS classes based on isCool selector', () => {
    render(
      <AuctionNavigation
        isFirstAuction={false}
        isLastAuction={false}
        onPrevAuctionClick={vi.fn()}
        onNextAuctionClick={vi.fn()}
      />,
    );

    const prevButton = screen.getAllByRole('button')[0];
    const nextButton = screen.getAllByRole('button')[1];

    // Since we mocked isCool to be true
    expect(prevButton.className).toContain('leftArrowCool');
    expect(nextButton.className).toContain('rightArrowCool');
  });
});
