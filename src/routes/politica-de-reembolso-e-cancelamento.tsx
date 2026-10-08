import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Package } from "lucide-react";
import { PolicyLayout, Bullets, ExtLink, type PolicySection } from "@/components/policies/PolicyLayout";
import { LEGAL_REFS, policyHead } from "@/lib/policies";

const PATH = "/politica-de-reembolso-e-cancelamento" as const;

export const Route = createFileRoute("/politica-de-reembolso-e-cancelamento")({
  head: () =>
    policyHead(
      PATH,
      "Política de Reembolso e Cancelamento",
      "Como cancelar pedidos, exercer o direito de arrependimento e solicitar reembolso de livros físicos e eBooks na Livraria Cultura.",
    ),
  component: RefundPolicy,
});

function Comparison() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="surface-card p-5">
        <h3 className="flex items-center gap-2 font-display font-semibold">
          <Package className="size-4 text-primary" /> Livros físicos
        </h3>
        <Bullets
          items={[
            "Cancelamento antes do envio: sem custo.",
            "Arrependimento em até 7 dias do recebimento (art. 49 do CDC), sem precisar justificar.",
            "Devolução sem ônus e restituição integral dos valores pagos, inclusive frete, quando legalmente devido.",
            "Defeito, avaria ou item errado: troca, abatimento ou reembolso conforme o CDC.",
          ]}
        />
      </div>
      <div className="surface-card p-5">
        <h3 className="flex items-center gap-2 font-display font-semibold">
          <BookOpen className="size-4 text-primary" /> eBooks
        </h3>
        <Bullets
          items={[
            "Arrependimento em até 7 dias da compra (art. 49 do CDC) — abrir ou baixar o arquivo não afasta esse direito, por si só.",
            "Falha no arquivo, conteúdo incorreto ou acesso não entregue: correção, substituição ou reembolso, quando cabível.",
            "Fora das hipóteses legais, não há reembolso por mera insatisfação após o acesso a conteúdo que corresponde à oferta e não apresenta falha.",
          ]}
        />
      </div>
    </div>
  );
}

const sections: PolicySection[] = [
  {
    id: "cancelamento",
    title: "Cancelamento antes do envio ou da liberação",
    body: (
      <>
        <p>
          Você pode pedir o cancelamento de um pedido de livro físico enquanto ele ainda não tiver
          sido despachado. Nesse caso, o pedido é cancelado e o valor pago é estornado integralmente.
        </p>
        <p>
          Se o pagamento ainda não tiver sido confirmado, o pedido pode simplesmente não ser
          concluído e nenhuma cobrança será efetivada.
        </p>
      </>
    ),
  },
  {
    id: "arrependimento",
    title: "Direito de arrependimento (7 dias)",
    body: (
      <>
        <p>
          Nas compras feitas pela internet, você pode desistir da compra em até 7 (sete) dias,
          conforme o{" "}
          <ExtLink href={LEGAL_REFS.cdc}>art. 49 do Código de Defesa do Consumidor</ExtLink> e o{" "}
          <ExtLink href={LEGAL_REFS.decreto7962}>Decreto nº 7.962/2013</ExtLink>. O prazo conta da
          data da compra (assinatura) ou do recebimento do produto, conforme aplicável.
        </p>
        <Bullets
          items={[
            "Não é necessário apresentar motivo; informar o motivo é opcional.",
            "A devolução de livro físico é feita sem ônus para você, e a restituição é integral, incluindo o frete quando legalmente devido.",
            "A embalagem original é recomendada para proteger o livro, mas não é condição para o exercício do direito.",
            "Esta política não cria prazo menor que o previsto em lei.",
          ]}
        />
      </>
    ),
  },
  {
    id: "defeito",
    title: "Livro físico com defeito, avaria ou item errado",
    body: (
      <>
        <p>
          Se o livro chegar com defeito de fabricação, danificado no transporte ou diferente do
          pedido, entre em contato. Aplicam-se a garantia legal e os direitos previstos nos{" "}
          <ExtLink href={LEGAL_REFS.cdc}>arts. 18 e 26 do CDC</ExtLink> (prazo de 90 dias para
          produtos duráveis), incluindo substituição do produto, abatimento proporcional do preço
          ou restituição do valor pago, nos termos da lei.
        </p>
        <p>
          Fotos do problema ajudam a agilizar a análise, mas não são condição para que você faça a
          solicitação.
        </p>
      </>
    ),
  },
  {
    id: "ebooks",
    title: "eBooks (livros digitais)",
    body: (
      <>
        <div className="grid gap-3">
          <p className="rounded-lg border border-border bg-secondary/50 p-4 font-medium">
            Fora das hipóteses de reembolso previstas em lei, não oferecemos reembolso por mera
            insatisfação após a abertura ou acesso ao ebook quando o conteúdo entregue corresponde à
            oferta e não apresenta falha.
          </p>
          <p className="rounded-lg border border-border bg-secondary/50 p-4 font-medium">
            A abertura, o acesso ou o download do ebook não afastam, por si só, o direito de
            arrependimento nem os demais direitos assegurados pelo Código de Defesa do Consumidor.
          </p>
        </div>
        <p>
          Nenhuma caixa de seleção, aviso ou aceite no momento da compra retira os direitos que a
          lei garante a você. Para exercer o arrependimento não é preciso comprovar defeito.
        </p>
        <p>Nas situações abaixo, oferecemos suporte, correção ou substituição e, quando cabível, reembolso:</p>
        <Bullets
          items={[
            "arquivo corrompido ou que não abre;",
            "conteúdo incorreto, incompleto ou diferente do título adquirido;",
            "acesso ou link de download não entregue;",
            "formato ou compatibilidade diferente do que foi anunciado na oferta;",
            "cobrança duplicada ou indevida.",
          ]}
        />
        <p>
          Quando um reembolso de eBook é efetivado, a licença de uso daquele exemplar digital
          termina e você deve deixar de usá-lo e excluir as cópias que tiver feito. Não há
          revogação técnica automática do arquivo; contamos com a sua boa-fé.
        </p>
      </>
    ),
  },
  {
    id: "pedidos-mistos",
    title: "Pedidos com livros físicos e eBooks",
    body: (
      <p>
        Em pedidos mistos, cada item é tratado individualmente segundo as regras aplicáveis ao seu
        tipo. Cancelar ou devolver um item não afeta os demais, salvo se você pedir o contrário.
      </p>
    ),
  },
  {
    id: "como-solicitar",
    title: "Como solicitar",
    body: (
      <>
        <p>Use o canal de atendimento indicado na seção Contato e informe:</p>
        <Bullets
          items={[
            "número do pedido;",
            "e-mail usado na compra;",
            "o que deseja (cancelamento, arrependimento, troca ou reembolso);",
            "motivo — opcional no caso de arrependimento.",
          ]}
        />
        <p>
          Confirmaremos o recebimento da sua solicitação, conforme exige o Decreto nº 7.962/2013,
          e informaremos as instruções de devolução quando houver livro físico a ser devolvido.
        </p>
      </>
    ),
  },
  {
    id: "estorno",
    title: "Estorno e prazos de visualização",
    body: (
      <>
        <p>
          Os pagamentos são processados pelo nosso provedor de pagamentos. Quando o reembolso é
          devido, solicitamos o estorno ao provedor — de imediato nos casos em que a lei exige,
          como no exercício do direito de arrependimento.
        </p>
        <p>
          O momento em que o valor aparece na sua fatura ou extrato depende do banco, da
          administradora do cartão ou do meio de pagamento utilizado, e não é controlado pela loja.
        </p>
      </>
    ),
  },
  {
    id: "outras",
    title: "Políticas relacionadas",
    body: (
      <p>
        Veja também a{" "}
        <Link to="/politica-de-entrega" className="text-primary underline">
          Política de Entrega
        </Link>{" "}
        e os{" "}
        <Link to="/termos-de-uso" className="text-primary underline">
          Termos de Uso
        </Link>
        .
      </p>
    ),
  },
];

function RefundPolicy() {
  return (
    <PolicyLayout
      path={PATH}
      title="Política de Reembolso e Cancelamento"
      intro={
        <p>
          Esta política explica como cancelar um pedido, desistir de uma compra e pedir reembolso
          de livros físicos e eBooks comprados na Livraria Cultura. Ela não substitui nem limita os
          direitos previstos no Código de Defesa do Consumidor.
        </p>
      }
      highlight={<Comparison />}
      sections={sections}
    />
  );
}
