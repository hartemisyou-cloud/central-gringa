import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { POLICY_PAGES, POLICY_STORE, type PolicyPath } from "@/lib/policies";
import { StoreFooter, BrandMark } from "./PolicyLinks";
import { cn } from "@/lib/utils";

export type PolicySection = { id: string; title: string; body: ReactNode };

export function PolicyLayout({
  path,
  title,
  intro,
  sections,
}: {
  path: PolicyPath;
  title: string;
  intro: ReactNode;
  sections: PolicySection[];
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
          <BrandMark />
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Back to the shop
          </Link>
        </div>
      </header>

      <div className="border-b border-border bg-secondary/50">
        <div className="mx-auto max-w-5xl px-5 py-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Store policies</p>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight md:text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: <time dateTime={POLICY_STORE.revisionDateISO}>{POLICY_STORE.revisionDate}</time>
          </p>
          <nav aria-label="Other policies" className="mt-6 flex flex-wrap gap-2">
            {POLICY_PAGES.map((page) => (
              <Link
                key={page.to}
                to={page.to}
                className={cn(
                  "rounded-full border border-border px-3 py-1 text-xs transition-colors",
                  page.to === path
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {page.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
        <div className="text-base leading-relaxed">{intro}</div>
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="scroll-mt-24 pt-10">
            <h2 className="font-display text-xl font-semibold">
              {i + 1}. {s.title}
            </h2>
            <div className="mt-3 space-y-3 leading-relaxed text-foreground/90">{s.body}</div>
          </section>
        ))}
        <section id="contact" className="pt-10">
          <div className="surface-card p-6">
            <h2 className="font-display text-xl font-semibold">Contact</h2>
            <ContactBlock />
          </div>
        </section>
      </main>
      <StoreFooter />
    </div>
  );
}

export function ContactBlock() {
  const s = POLICY_STORE;
  return (
    <div className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
      {s.supportEmail ? (
        <p>
          Email: <a className="underline" href={`mailto:${s.supportEmail}`}>{s.supportEmail}</a>
        </p>
      ) : (
        <p>
          For questions, cancellations, refunds or privacy requests, reply to your order
          confirmation and include your order number and the email used at checkout.
        </p>
      )}
    </div>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
      {children}
    </a>
  );
}
