import { createFileRoute, Link } from "@tanstack/react-router";
import { PolicyLayout, Bullets, ExtLink, type PolicySection } from "@/components/policies/PolicyLayout";
import { LEGAL_REFS, policyHead } from "@/lib/policies";

const PATH = "/politica-de-entrega" as const;

export const Route = createFileRoute("/politica-de-entrega")({
  head: () =>
    policyHead(
      PATH,
      "Política de Entrega",
      "Como funcionam o envio de livros físicos e a entrega de eBooks na Livraria Cultura: frete, prazos, rastreio e suporte.",
    ),
  component: DeliveryPolicy,
});

const sections: PolicySection[] = [
  {
    id: "confirmacao",
    title: "Confirmação do pagamento",
    body: (
      <p>
        O envio de livros físicos e a liberação de eBooks acontecem após a confirmação do
        pagamento pelo provedor de pagamentos. Pedidos com pagamento pendente ou recusado não são
        enviados nem liberados.
      </p>
    ),
  },
  {
    id: "fisicos",
    title: "Livros físicos",
    body: (
      <>
        <Bullets
          items={[
            "O valor do frete e o prazo estimado de entrega são informados antes da finalização da compra, conforme o endereço informado.",
            "O prazo começa a contar a partir da confirmação do pagamento.",
            "Quando a modalidade de envio oferecer código de rastreio, ele será informado pelo canal de atendimento do pedido.",
            "Confira o endereço com atenção; se precisar corrigir, avise antes do envio.",
          ]}
        />
      </>
    ),
  },
  {
    id: "atrasos",
    title: "Atrasos, extravios e entregas não realizadas",
    body: (
      <>
        <p>
          Se o pedido atrasar além do prazo informado, for extraviado ou chegar danificado, entre
          em contato. Vamos verificar com a transportadora e oferecer uma solução, como novo envio
          ou reembolso, preservando os direitos do{" "}
          <ExtLink href={LEGAL_REFS.cdc}>Código de Defesa do Consumidor</ExtLink>.
        </p>
        <p>
          Avarias e itens errados também seguem a{" "}
          <Link to="/politica-de-reembolso-e-cancelamento" className="text-primary underline">
            Política de Reembolso e Cancelamento
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    id: "ebooks",
    title: "eBooks",
    body: (
      <>
        <Bullets
          items={[
            "eBooks não têm frete físico.",
            "O acesso é disponibilizado após a confirmação do pagamento, na forma indicada na oferta do produto (por exemplo, link ou página de download).",
            "O formato do arquivo (como PDF) e eventuais requisitos de leitura são os informados na oferta.",
            "Guarde uma cópia do arquivo baixado; a disponibilidade do link pode variar e não garantimos acesso vitalício ao link de download.",
          ]}
        />
        <p>
          Se você não receber o acesso, ou o arquivo apresentar problema, fale conosco com o número
          do pedido para que possamos reenviar, corrigir ou, quando cabível, reembolsar.
        </p>
      </>
    ),
  },
  {
    id: "mistos",
    title: "Pedidos mistos",
    body: (
      <p>
        Em pedidos com livros físicos e eBooks, os eBooks podem ser liberados antes do envio dos
        livros físicos. Cada item segue o seu próprio fluxo de entrega.
      </p>
    ),
  },
];

function DeliveryPolicy() {
  return (
    <PolicyLayout
      path={PATH}
      title="Política de Entrega"
      intro={
        <p>
          Aqui você encontra como entregamos livros físicos e eBooks. Prazos e valores específicos
          de cada compra são sempre os exibidos antes da finalização do pedido.
        </p>
      }
      sections={sections}
    />
  );
}
