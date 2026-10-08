/**
 * Dados centralizados das políticas públicas da loja.
 * Campos `null` ainda não foram informados/verificados — as páginas exibem um
 * texto transparente em vez de inventar o dado. Preencha aqui quando disponível.
 */
export const POLICY_STORE = {
  brandName: "Livraria Cultura",
  siteUrl: "https://livrariadacultura.shop",
  legalName: null as string | null,
  cnpj: null as string | null,
  address: null as string | null,
  supportEmail: null as string | null,
  supportPhone: null as string | null,
  revisionDate: "07/10/2026",
  revisionDateISO: "2026-10-07",
};

export const POLICY_PAGES = [
  { to: "/politica-de-reembolso-e-cancelamento", label: "Reembolso e cancelamento" },
  { to: "/politica-de-entrega", label: "Entrega" },
  { to: "/politica-de-privacidade", label: "Privacidade" },
  { to: "/politica-de-cookies", label: "Cookies" },
  { to: "/termos-de-uso", label: "Termos de uso" },
] as const;

export type PolicyPath = (typeof POLICY_PAGES)[number]["to"];

export const LEGAL_REFS = {
  cdc: "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm",
  decreto7962: "https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm",
  lgpd: "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm",
  anpdCookies:
    "https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_cookies_e_protecao_de_dados_pessoais",
};

export function policyHead(path: PolicyPath, title: string, description: string) {
  const url = `${POLICY_STORE.siteUrl}${path}`;
  const fullTitle = `${title} — ${POLICY_STORE.brandName}`;
  return {
    meta: [
      { title: fullTitle },
      { name: "description", content: description },
      { property: "og:title", content: fullTitle },
      { property: "og:description", content: description },
      { property: "og:type", content: "article" },
      { property: "og:url", content: url },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
