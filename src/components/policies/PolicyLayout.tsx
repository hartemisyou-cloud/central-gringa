import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import { POLICY_PAGES, POLICY_STORE, type PolicyPath } from "@/lib/policies";
import { StoreFooter } from "./PolicyLinks";
import { cn } from "@/lib/utils";

export type PolicySection = { id: string; title: string; body: ReactNode };

export function PolicyLayout({
  path,
  title,
  intro,
  highlight,
  sections,
}: {
  path: PolicyPath;
  title: string;
  intro: ReactNode;
  highlight?: ReactNode;
  sections: PolicySection[];
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ShoppingBag className="size-4" />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">
              {POLICY_STORE.brandName}
            </span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Voltar à loja
          </Link>
        </div>
      </header>

      <div className="border-b border-border bg-secondary/50">
        <div className="mx-auto max-w-5xl px-5 py-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Políticas da loja
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight md:text-4xl">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Última revisão:{" "}
            <time dateTime={POLICY_STORE.revisionDateISO}>{POLICY_STORE.revisionDate}</time>
          </p>
          <nav aria-label="Outras políticas" className="mt-6 flex flex-wrap gap-2">
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

      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-10 px-5 py-10 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Nesta página
          </p>
          <ol className="mt-3 space-y-2 text-sm">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-muted-foreground hover:text-foreground">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
            <li>
              <a href="#contato" className="text-muted-foreground hover:text-foreground">
                {sections.length + 1}. Contato
              </a>
            </li>
          </ol>
        </aside>

        <article className="policy-prose max-w-[68ch]">
          <div className="text-base leading-relaxed">{intro}</div>
          {highlight ? <div className="mt-8">{highlight}</div> : null}
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24 pt-10">
              <h2 className="font-display text-xl font-semibold">
                {i + 1}. {s.title}
              </h2>
              <div className="mt-3 space-y-3 leading-relaxed text-foreground/90">{s.body}</div>
            </section>
          ))}
          <section id="contato" className="scroll-mt-24 pt-10">
            <div className="surface-card p-6">
              <h2 className="font-display text-xl font-semibold">
                {sections.length + 1}. Contato
              </h2>
              <ContactBlock />
            </div>
          </section>
        </article>
      </main>

      <StoreFooter />
    </div>
  );
}

export function ContactBlock() {
  const s = POLICY_STORE;
  const hasDirect = s.supportEmail || s.supportPhone;
  return (
    <div className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
      {hasDirect ? (
        <ul className="space-y-1">
          {s.supportEmail ? (
            <li>
              E-mail: <a className="underline" href={`mailto:${s.supportEmail}`}>{s.supportEmail}</a>
            </li>
          ) : null}
          {s.supportPhone ? <li>Telefone: {s.supportPhone}</li> : null}
        </ul>
      ) : (
        <p>
          Para dúvidas, solicitações de cancelamento, arrependimento, troca, reembolso ou sobre seus
          dados pessoais, utilize o canal de atendimento indicado na confirmação do seu pedido,
          informando o número do pedido e o e-mail usado na compra.
        </p>
      )}
      {s.legalName || s.cnpj || s.address ? (
        <p className="text-muted-foreground">
          {[s.legalName, s.cnpj ? `CNPJ ${s.cnpj}` : null, s.address].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

/** Lista simples com marcadores. */
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
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
      {children}
    </a>
  );
}
