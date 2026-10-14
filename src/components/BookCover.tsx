import { cn } from "@/lib/utils";

const TONES = ["bg-primary text-primary-foreground", "bg-accent text-accent-foreground", "bg-foreground text-background", "bg-secondary text-secondary-foreground"];

/** Original typographic cover — no artwork from any historical or modern edition. */
export function BookCover({ title, author, index, className }: { title: string; author: string; index: number; className?: string }) {
  return (
    <div className={cn("flex aspect-[2/3] flex-col justify-between p-5", TONES[index % TONES.length], className)}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.25em] opacity-70">Hope Human Books</span>
      <div>
        <p className="font-display text-xl leading-tight font-semibold">{title}</p>
        <div className="my-3 h-px w-10 bg-current opacity-50" />
        <p className="text-sm opacity-80">{author}</p>
      </div>
    </div>
  );
}

/** Splits a catalog name "Title — Author" into parts. */
export function splitName(name: string): { title: string; author: string } {
  const [title, author] = name.split(" — ");
  return { title: title ?? name, author: author ?? "" };
}
