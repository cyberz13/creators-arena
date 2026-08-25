import { LogoMark } from "./logo";

/** Instant navigation feedback — shown by Next the moment a link is tapped. */
export function PageLoader() {
  return (
    <div className="grid min-h-[60dvh] place-items-center">
      <div className="flex flex-col items-center gap-4">
        <LogoMark className="h-9 animate-pulse" />
        <div className="h-1 w-36 overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full w-1/3 rounded-full bg-brand-500 [animation:loaderSlide_1s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  );
}
