// /icecreamvan: the icecreamvan.eth scene (a standalone three.js page in
// public/icecreamvan-scene/) shown inside a NounOS window like every other page.
// data-page-fill: the iframe takes the window's exact height (it used to be
// sized from the viewport, so a short window scrolled a taller scene).

export default function IceCreamVanPage() {
  return (
    <iframe
      src="/icecreamvan-scene/index.html"
      title="icecreamvan.eth"
      allow="fullscreen; autoplay"
      data-page-fill=""
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        minHeight: 320,
        border: 0,
      }}
    />
  );
}
