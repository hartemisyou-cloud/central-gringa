import { createFileRoute, Link } from "@tanstack/react-router";
import { PolicyLayout, Bullets, ExtLink, type PolicySection } from "@/components/policies/PolicyLayout";
import { LEGAL_REFS, policyHead } from "@/lib/policies";

const PATH = "/politica-de-cookies" as const;

export const Route = createFileRoute("/politica-de-cookies")({
  head: () =>
    policyHead(
      PATH,
      "Política de Cookies",
      "Quais cookies e dados de armazenamento local a Livraria Cultura usa, para que servem e como gerenciá-los no navegador.",
    ),
  component: CookiesPolicy,
});

const rows: { name: string; type: string; purpose: string; who: string }[] = [
  { name: "loja1.cart.v1", type: "Armazenamento local", purpose: "Guardar os itens do carrinho entre visitas.", who: "Loja" },
  { name: "lc.attribution", type: "Armazenamento de sessão", purpose: "Guardar a origem da visita (UTMs, fbclid, página de entrada e referrer) para associá-la ao pedido.", who: "Loja" },
  { name: "Sessão de pagamento", type: "Armazenamento de sessão", purpose: "Manter os dados da etapa de pagamento enquanto a aba estiver aberta; removido ao concluir.", who: "Loja" },
  { name: "csp_anon_session", type: "Armazenamento local", purpose: "Identificador anônimo para medir visitas e etapas do checkout.", who: "Loja" },
  { name: "csp_presence_session, csp_presence_tabs", type: "Armazenamento local", purpose: "Medir visitantes ativos no momento.", who: "Loja" },
  { name: "_fbp, _fbc", type: "Cookies", purpose: "Mensuração de anúncios do Meta (Pixel), quando ativo.", who: "Meta Platforms" },
  { name: "Cookies do provedor de pagamentos", type: "Cookies", purpose: "Funcionamento seguro do formulário de pagamento e prevenção a fraudes.", who: "Stripe" },
];

const sections: PolicySection[] = [
  {
    id: "o-que-sao",
    title: "O que são cookies e armazenamento local",
    body: (
      <p>
        Cookies são pequenos arquivos gravados pelo navegador. O armazenamento local e o de sessão
        são recursos parecidos, que guardam informações no seu próprio dispositivo — o de sessão é
        apagado ao fechar a aba.
      </p>
    ),
  },
  {
    id: "quais",
    title: "O que usamos",
    body: (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Nome</th>
              <th className="py-2 pr-3 font-medium">Tipo</th>
              <th className="py-2 pr-3 font-medium">Finalidade</th>
              <th className="py-2 font-medium">Responsável</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-border align-top">
                <td className="py-2 pr-3 font-mono text-xs">{r.name}</td>
                <td className="py-2 pr-3">{r.type}</td>
                <td className="py-2 pr-3">{r.purpose}</td>
                <td className="py-2">{r.who}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
  {
    id: "categorias",
    title: "Categorias",
    body: (
      <Bullets
        items={[
          <><strong>Necessários:</strong> carrinho, sessão de pagamento e cookies do provedor de pagamentos. Sem eles, a compra não funciona.</>,
          <><strong>Medição e marketing:</strong> identificadores anônimos de visita, origem da visita e cookies do Meta Pixel.</>,
        ]}
      />
    ),
  },
  {
    id: "gerenciar",
    title: "Como gerenciar",
    body: (
      <>
        <p>
          No momento, a loja não oferece um painel próprio de preferências de cookies. Você pode
          controlar cookies e dados armazenados pelo seu navegador:
        </p>
        <Bullets
          items={[
            "apagar cookies e dados de sites nas configurações de privacidade;",
            "bloquear cookies de terceiros;",
            "usar navegação anônima/privativa, que descarta os dados ao fechar a janela.",
          ]}
        />
        <p>
          Bloquear ou apagar itens necessários pode esvaziar o carrinho ou impedir o pagamento. Você
          também pode se opor ao uso para marketing pelo canal indicado na seção Contato.
        </p>
        <p>
          Referência:{" "}
          <ExtLink href={LEGAL_REFS.anpdCookies}>Guia orientativo de cookies da ANPD</ExtLink>. Veja
          também a{" "}
          <Link to="/politica-de-privacidade" className="text-primary underline">
            Política de Privacidade
          </Link>
          .
        </p>
      </>
    ),
  },
];

function CookiesPolicy() {
  return (
    <PolicyLayout
      path={PATH}
      title="Política de Cookies"
      intro={
        <p>
          Explicamos quais cookies e dados de armazenamento local são usados na loja e nas páginas
          de pagamento, para que servem e como você pode gerenciá-los.
        </p>
      }
      sections={sections}
    />
  );
}
