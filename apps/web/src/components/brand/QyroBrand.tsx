import clsx from "clsx";

type Surface = "lead" | "assist" | "core";

const SURFACE_STYLES: Record<Surface, {
  ring: string;
  title: string;
  subtitle: string;
}> = {
  lead: {
    ring: "from-orange-300 via-orange-500 to-orange-700",
    title: "text-stone-900",
    subtitle: "text-orange-700",
  },
  assist: {
    ring: "from-orange-300 via-orange-500 to-orange-700",
    title: "text-stone-900",
    subtitle: "text-orange-700",
  },
  core: {
    ring: "from-orange-300 via-orange-500 to-orange-700",
    title: "text-stone-900",
    subtitle: "text-orange-700",
  },
};

export function QyroMark({
  surface = "core",
  className,
}: {
  surface?: Surface;
  className?: string;
}) {
  const tone = SURFACE_STYLES[surface];

  return (
    <div className={clsx("relative isolate h-10 w-10 rounded-2xl p-[1.5px] shadow-[0_10px_22px_rgba(20,20,20,0.16)]", className)}>
      <div className={clsx("absolute inset-0 rounded-2xl bg-gradient-to-br", tone.ring)} />
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[14px] bg-[#111111]">
        <svg viewBox="0 0 64 64" aria-hidden="true" className="h-8 w-8">
          <defs>
            <linearGradient id={`qyro-core-${surface}`} x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#FFF7ED" />
              <stop offset="0.55" stopColor="#FDBA74" />
              <stop offset="1" stopColor="#FB923C" />
            </linearGradient>
          </defs>
          <circle cx="29" cy="29" r="13" fill="none" stroke={`url(#qyro-core-${surface})`} strokeWidth="8" />
          <path d="M37 37 L49 49" stroke={`url(#qyro-core-${surface})`} strokeWidth="8" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

export function QyroBrandLockup({
  surface = "core",
  product,
  subtitle,
  align = "left",
}: {
  surface?: Surface;
  product?: string;
  subtitle?: string;
  align?: "left" | "center";
}) {
  const tone = SURFACE_STYLES[surface];

  return (
    <div className={clsx("flex items-center gap-3", align === "center" && "justify-center text-center") }>
      <QyroMark surface={surface} className="h-11 w-11 shrink-0" />
      <div>
        <p className={clsx("text-sm font-semibold leading-none", tone.title)}>
          {product ? `QYRO ${product}` : "QYRO"}
        </p>
        {subtitle ? (
          <p className={clsx("mt-0.5 text-xs font-medium", tone.subtitle)}>{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}