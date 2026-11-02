/**
 * @deprecated Viewport width says nothing about the NounOS window a page is in.
 * Use `useContainerWidth().below('lg')` (src/hooks/useContainerWidth.ts) for
 * layout, or `(pointer: coarse)` for touch. Fixed portals sized against the
 * viewport (modals) are the only fair use left.
 */
export const isMobileScreen = () => {
  return window.innerWidth < 992;
};
