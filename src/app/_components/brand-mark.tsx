import Image from "next/image";
import { cn } from "@/lib/utils";

/** The selected four-page logo, shared by the home, login and workspace headers. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <Image
      alt=""
      className={cn("size-8 shrink-0", className)}
      height={32}
      src="/brand/cdas-logo.svg"
      unoptimized
      width={32}
    />
  );
}
