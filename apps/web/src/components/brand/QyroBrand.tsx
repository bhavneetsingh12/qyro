import clsx from "clsx";

type Surface = "lead" | "assist" | "core";

const SURFACE_STYLES: Record<Surface, {
  mark: string;
  title: string;
  subtitle: string;
}> = {
  lead: {
    mark: "bg-amber-500",
    title: "text-stone-900",
    subtitle: "text-stone-400",
  },
  assist: {
    mark: "bg-amber-500",
    title: "text-stone-900",
    subtitle: "text-stone-400",
  },
  core: {
    mark: "bg-amber-500",
    title: "text-stone-900",
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
    <div className={clsx("h-7 w-7 rounded-lg flex items-center justify-center shadow-sm", tone.mark, className)}>
      <span className="text-white text-xs font-bold leading-none">Q</span>
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
    <div className={clsx("flex items-center gap-2", align === "center" && "justify-center text-center") }>
      <QyroMark surface={surface} className="shrink-0" />
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