import { Link } from "@tanstack/react-router";
import { POLICY_PAGES } from "@/lib/policies";
import { cn } from "@/lib/utils";

/** Links discretos para as políticas — usados em rodapés e páginas de pagamento. */
export function PolicyLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Políticas da loja" className={cn("text-xs", className)}>
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
        <p className="text-xs">© {new Date().getFullYear()} Livraria Cultura</p>
      </div>
    </footer>
  );
}
