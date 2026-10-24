// The "?" with a plain-words explanation (hover, focus or tap).
export default function Tip({ text }: { text: string }) {
  return (
    <span className="nz-tip" tabIndex={0} role="note" aria-label={text} data-tip={text}>
      ?
    </span>
  );
}
