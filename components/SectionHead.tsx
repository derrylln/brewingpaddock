import type { ReactNode } from "react";

export default function SectionHead({
  index,
  title,
  kicker,
  children,
}: {
  index: string;
  title: string;
  kicker?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div className="section-head-main">
        <span className="section-index mono">{index}</span>
        <div>
          {kicker ? <p className="section-kicker mono">{kicker}</p> : null}
          <h2 className="section-title">{title}</h2>
        </div>
      </div>
      {children ? <div className="section-head-aside">{children}</div> : null}
    </div>
  );
}
