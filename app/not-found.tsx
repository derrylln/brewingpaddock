import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page">
      <div className="shell empty-state panel">
        <p className="mono kicker-red">BOX BOX BOX</p>
        <h1 className="page-title">
          Wrong
          <br />
          <em>pit box.</em>
        </h1>
        <p className="page-deck">
          That page is not on the timing sheet. Head back to the desk and pick a session.
        </p>
        <Link className="btn btn-primary" href="/">
          Back to the desk
        </Link>
      </div>
    </div>
  );
}
