import clsx from "clsx";

type Surface = "lead" | "assist" | "core";

const SURFACE_STYLES: Record<Surface, {
  ring: string;
  chip: string;
  subtitle: string;
}> = {
  lead: {
    ring: "from-amber-500 via-orange-500 to-rose-500",
    chip: "bg-amber-50 text-amber-700 border-amber-200",
    subtitle: "text-amber-600",
  },
  assist: {
    ring: "from-teal-500 via-cyan-500 to-sky-500",
    chip: "bg-teal-50 text-teal-700 border-teal-200",
    subtitle: "text-teal-600",
  },
  core: {
    ring: "from-amber-500 via-orange-500 to-teal-500",
    chip: "bg-stone-100 text-stone-700 border-stone-200",
    subtitle: "text-stone-500",
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
    <div className={clsx("relative isolate h-10 w-10 rounded-2xl p-[1.5px] shadow-[0_12px_30px_rgba(20,20,20,0.12)]", className)}>
      <div className={clsx("absolute inset-0 rounded-2xl bg-gradient-to-br", tone.ring)} />
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[14px] bg-[#111111]">
        <svg viewBox="0 0 64 64" aria-hidden="true" className="h-8 w-8">
          <defs>
            <linearGradient id={`qyro-core-${surface}`} x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#FFF4D6" />
              <stop offset="0.5" stopColor="#FFD08A" />
              <stop offset="1" stopColor="#7EE7D8" />
            </linearGradient>
          </defs>
          <path
            d="M32 8c13.255 0 24 10.745 24 24S45.255 56 32 56 8 45.255 8 32 18.745 8 32 8Zm0 8c-8.837 0-16 7.163-16 16s7.163 16 16 16c2.964 0 5.74-.807 8.122-2.212l7.063 7.062 5.656-5.656-6.929-6.929A15.93 15.93 0 0 0 48 32c0-8.837-7.163-16-16-16Zm0 8a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z"
            fill={`url(#qyro-core-${surface})`}
          />
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
        <div className={clsx("inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]", tone.chip)}>
          QYRO
          {product ? <span className="opacity-75">{product}</span> : null}
        </div>
        {subtitle ? (
          <p className={clsx("mt-1 text-sm font-medium", tone.subtitle)}>{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}