import "./brand.css";

/** The existing Leader mark, paired with font-independent SVG letterforms. */
export function Brand({ className = "", decorative = false }: {
  className?: string;
  decorative?: boolean;
}) {
  return (
    <span className={`brand ${className}`} role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Swarmcrews"} aria-hidden={decorative || undefined}>
      <span className="brand__mark" />
      <span className="brand__wordmark"><span className="brand__swarm" /><span className="brand__crews" /></span>
    </span>
  );
}
