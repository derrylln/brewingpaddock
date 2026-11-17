/**
 * The brand mark is a file, not code: `public/brand/logo.png`.
 *
 * To use the original artwork, drop your file over that path (square crop of the
 * icon, transparent background, 512px or larger) — nothing else to change. The
 * header picks it up on the next build. For the favicon, do the same with
 * `app/icon.png` and delete `app/icon.svg`.
 */
export default function BrandMark({ className }: { className?: string }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      className={className}
      src="/brand/logo.png"
      alt=""
      width={34}
      height={34}
      aria-hidden="true"
      decoding="async"
    />
  );
}
