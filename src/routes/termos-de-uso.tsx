import { createFileRoute, Link } from "@tanstack/react-router";
import { PolicyLayout, Bullets, ExtLink, type PolicySection } from "@/components/policies/PolicyLayout";
import { LEGAL_REFS, policyHead } from "@/lib/policies";

const PATH = "/termos-de-uso" as const;

export const Route = createFileRoute("/termos-de-uso")({
  head: () =>
    policyHead(
      PATH,
      "Termos de Uso",
      "Condições de uso da loja e de compra de livros físicos e eBooks na Livraria Cultura, incluindo licença de uso dos eBooks.",
    ),
  component: Terms,
});

const L = ({ to, children }: { to: "/politica-de-reembolso-e-cancelamento" | "/politica-de-entrega" | "/politica-de-privacidade" | "/politica-de-cookies"; children: string }) => (
  <Link to={to} className="text-primary underline">{children}</Link>
);

const sections: PolicySection[] = [
  {
    id: "aceitacao",
    title: "Uso da loja",
    body: (
      <p>
        Ao navegar e comprar na Livraria Cultura, você concorda com estes Termos e com as políticas
        da loja. Estes Termos não afastam nem limitam os direitos garantidos pelo{" "}
        <ExtLink href={LEGAL_REFS.cdc}>Código de Defesa do Consumidor</ExtLink>.
      </p>
    ),
  },
  {
    id: "produtos",
    title: "Livros físicos e eBooks",
    body: (
      <>
        <p>
          Cada oferta indica se o produto é um livro físico (entregue no endereço informado) ou um
          eBook (arquivo digital, sem entrega física). Preço, disponibilidade, formato e forma de
          entrega são os informados na oferta e confirmados no checkout.
        </p>
        <p>
          A disponibilidade de estoque é verificada no momento do pedido. Se, por qualquer motivo,
          não for possível atender um pedido já pago, você será informado e receberá a restituição
          integral do valor.
        </p>
      </>
    ),
  },
  {
    id: "pagamento",
    title: "Pagamento",
    body: (
      <p>
        Os pagamentos são processados pela Stripe. O pedido é confirmado após a aprovação do
        pagamento. O valor total, incluindo frete quando houver, é exibido antes da finalização.
      </p>
    ),
  },
  {
    id: "licenca",
    title: "Licença de uso dos eBooks",
    body: (
      <>
        <p>
          A compra de um eBook concede a você uma licença pessoal, não exclusiva e intransferível
          para ler o conteúdo em seus dispositivos, para uso próprio e não comercial.
        </p>
        <p>Não é permitido, sem autorização dos titulares de direitos:</p>
        <Bullets
          items={[
            "redistribuir, compartilhar publicamente, revender ou disponibilizar o arquivo a terceiros;",
            "reproduzir o conteúdo para fins comerciais;",
            "remover avisos de direitos autorais.",
          ]}
        />
        <p>
          As obras são protegidas pela legislação de direitos autorais (Lei nº 9.610/1998).
        </p>
      </>
    ),
  },
  {
    id: "responsabilidades",
    title: "Responsabilidades",
    body: (
      <>
        <p>
          A loja responde pelos produtos e serviços que oferece nos termos da legislação de defesa
          do consumidor. Você é responsável pela veracidade dos dados informados no pedido, como
          endereço e e-mail.
        </p>
        <p>
          Eventuais erros evidentes de preço ou descrição serão comunicados, e você poderá optar
          entre manter a compra nas condições corretas ou cancelá-la com restituição integral.
        </p>
      </>
    ),
  },
  {
    id: "politicas",
    title: "Políticas da loja",
    body: (
      <Bullets
        items={[
          <L to="/politica-de-reembolso-e-cancelamento">Política de Reembolso e Cancelamento</L>,
          <L to="/politica-de-entrega">Política de Entrega</L>,
          <L to="/politica-de-privacidade">Política de Privacidade</L>,
          <L to="/politica-de-cookies">Política de Cookies</L>,
        ]}
      />
    ),
  },
  {
    id: "alteracoes",
    title: "Alterações e foro",
    body: (
      <p>
        Podemos atualizar estes Termos; a data da última revisão fica no topo da página. Compras já
        realizadas seguem as condições vigentes no momento da compra. Aplica-se a legislação
        brasileira, e você pode buscar seus direitos no foro do seu domicílio, conforme o CDC.
      </p>
    ),
  },
];

function Terms() {
  return (
    <PolicyLayout
      path={PATH}
      title="Termos de Uso"
      intro={<p>Estas são as condições para usar a loja e comprar livros físicos e eBooks.</p>}
      sections={sections}
    />
  );
}
