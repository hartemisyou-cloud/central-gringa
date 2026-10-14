import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { POLICY_PAGES } from "@/lib/policies";
import { cn } from "@/lib/utils";

export function BrandMark() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <span className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground">
        <BookOpen className="size-4" />
      </span>
      <span className="font-display text-lg font-semibold tracking-tight">Hope Human Books</span>
    </Link>
  );
}

/** Discreet policy links — used in footers and payment pages. */
export function PolicyLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Store policies" className={cn("text-xs", className)}>
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {POLICY_PAGES.map((page) => (
          <li key={page.to}>
            <Link to={page.to} className="opacity-80 underline-offset-4 hover:underline hover:opacity-100">
              {page.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function StoreFooter() {
  return (
    <footer className="border-t border-border bg-secondary/40">
      <div className="mx-auto max-w-6xl space-y-3 px-5 py-8 text-center text-muted-foreground">
        <PolicyLinks />
        <p className="mx-auto max-w-2xl text-xs">
          Hope Human Books sells curated digital editions of works that are in the public domain in
          the United States. Source texts are freely available elsewhere. Purchases are not
          charitable donations.
        </p>
        <p className="text-xs">© {new Date().getFullYear()} Hope Human Books</p>
      </div>
    </footer>
  );
}
