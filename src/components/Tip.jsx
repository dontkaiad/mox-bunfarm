// Inline "?" tooltip badge — uses native browser title attribute.
export default function Tip({ text }) {
  return <abbr className="tip" title={text}>?</abbr>
}
