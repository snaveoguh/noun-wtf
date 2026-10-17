// /icecreamvan: the icecreamvan.eth scene (a standalone three.js page in
// public/icecreamvan-scene/) shown inside a NounOS window like every other page.

export default function IceCreamVanPage() {
  return (
    <iframe
      src="/icecreamvan-scene/index.html"
      title="icecreamvan.eth"
      allow="fullscreen; autoplay"
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        minHeight: 'calc(100vh - 160px)',
        border: 0,
      }}
    />
  );
}
