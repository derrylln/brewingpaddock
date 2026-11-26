/** Renders a generated read, keeping the model's paragraph breaks. */
export default function AiReadText({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className="ai-read">
      {(paragraphs.length > 0 ? paragraphs : [text]).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}
