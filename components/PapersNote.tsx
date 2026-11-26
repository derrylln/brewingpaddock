import Link from "next/link";
import { REPORTS, eventDocuments, watchDocuments } from "@/lib/fia-reports";

/**
 * A one-line pointer from the strategist to the FIA paper trail. The papers
 * annotate the race; they are deliberately not an input to the forecast numbers.
 */
export default function PapersNote() {
  const docs = eventDocuments();
  if (docs.length === 0) return null;
  const top = watchDocuments(1)[0] ?? docs[0];

  return (
    <Link href="/papers" className="papers-strip">
      <span className="mono papers-strip-label">FIA papers · {docs.length}</span>
      <span className="papers-strip-title">
        {top.teamLabel ? `${top.teamLabel}: ` : ""}
        {top.title}
      </span>
      <span className="mono papers-strip-more">Read the papers →</span>
    </Link>
  );
}
