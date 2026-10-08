import { createFileRoute, Link } from "@tanstack/react-router";
import { PolicyLayout, Bullets, ExtLink, type PolicySection } from "@/components/policies/PolicyLayout";
import { LEGAL_REFS, policyHead } from "@/lib/policies";

const PATH = "/politica-de-privacidade" as const;

export const Route = createFileRoute("/politica-de-privacidade")({
  head: () =>
    policyHead(
      PATH,
      "Política de Privacidade",
      "Quais dados pessoais a Livraria Cultura coleta, para que usa, com quem compartilha e como você pode exercer seus direitos pela LGPD.",
    ),
  component: PrivacyPolicy,
});

const sections: PolicySection[] = [
  {
    id: "dados",
    title: "Dados que coletamos",
    body: (
      <>
        <p><strong>Dados do pedido</strong>, informados por você no checkout:</p>
        <Bullets
          items={[
            "nome e sobrenome, e-mail e telefone;",
            "endereço de entrega (CEP, rua, número, complemento, bairro, cidade e UF);",
            "itens comprados, valores, frete e status do pedido e do pagamento.",
          ]}
        />
        <p><strong>Dados de pagamento:</strong> os dados do cartão são digitados diretamente no
          formulário do provedor de pagamentos (Stripe). A loja não recebe nem armazena o número
          completo do cartão nem o código de segurança.</p>
        <p><strong>Dados de navegação e origem da visita:</strong></p>
        <Bullets
          items={[
            "identificadores de sessão anônimos gerados no navegador, usados para medir visitas e etapas do checkout;",
            "parâmetros de campanha (UTMs como utm_source, utm_medium, utm_campaign, utm_content, utm_term), identificador de clique do Facebook (fbclid), página de entrada e página de origem (referrer);",
            "identificadores dos cookies do Meta Pixel (_fbp e _fbc), quando o Pixel está ativo;",
            "endereço IP e informações do navegador (user agent).",
          ]}
        />
      </>
    ),
  },
  {
    id: "finalidades",
    title: "Finalidades e bases legais",
    body: (
      <Bullets
        items={[
          <><strong>Processar e entregar o pedido</strong>, emitir comunicações sobre ele e prestar atendimento — execução de contrato (art. 7º, V, da LGPD).</>,
          <><strong>Processar o pagamento e prevenir fraudes</strong> — execução de contrato e legítimo interesse (art. 7º, V e IX), e prevenção à fraude (art. 11, II, "g", quando aplicável).</>,
          <><strong>Cumprir obrigações legais e regulatórias</strong>, como fiscais e de defesa do consumidor — cumprimento de obrigação legal (art. 7º, II).</>,
          <><strong>Exercer direitos em processos e disputas</strong>, inclusive contestações de pagamento — exercício regular de direitos (art. 7º, VI).</>,
          <><strong>Medir o desempenho da loja e de campanhas de marketing</strong> (analytics, Meta Pixel, Meta Conversions API e UTMify) — legítimo interesse (art. 7º, IX), observados os seus direitos de oposição.</>,
        ]}
      />
    ),
  },
  {
    id: "compartilhamento",
    title: "Compartilhamento",
    body: (
      <>
        <p>Compartilhamos dados apenas na medida necessária, com:</p>
        <Bullets
          items={[
            "Stripe — processamento de pagamentos e prevenção a fraudes;",
            "Meta Platforms (Meta Pixel e Conversions API) — mensuração de anúncios; e-mail e telefone, quando enviados, seguem em formato de hash, conforme o padrão da Meta;",
            "UTMify — atribuição de vendas a campanhas de marketing;",
            "provedores de hospedagem e banco de dados que operam a loja;",
            "transportadoras, para entrega de livros físicos;",
            "autoridades públicas, quando exigido por lei ou ordem judicial.",
          ]}
        />
        <p>Alguns desses fornecedores podem tratar dados fora do Brasil, nos termos da LGPD.</p>
      </>
    ),
  },
  {
    id: "retencao",
    title: "Retenção",
    body: (
      <p>
        Mantemos os dados pelo tempo necessário para cumprir as finalidades descritas, obrigações
        legais e regulatórias e para o exercício de direitos em eventuais disputas. Encerradas
        essas necessidades, os dados são eliminados, observadas as hipóteses de conservação do
        art. 16 da LGPD.
      </p>
    ),
  },
  {
    id: "seguranca",
    title: "Segurança",
    body: (
      <p>
        Adotamos medidas técnicas e administrativas razoáveis para proteger os dados, como conexões
        criptografadas, controle de acesso e o uso de um provedor de pagamentos especializado.
        Nenhum sistema é totalmente imune a incidentes, e não podemos garantir segurança absoluta.
      </p>
    ),
  },
  {
    id: "direitos",
    title: "Seus direitos",
    body: (
      <>
        <p>
          Conforme o art. 18 da <ExtLink href={LEGAL_REFS.lgpd}>Lei nº 13.709/2018 (LGPD)</ExtLink>,
          você pode solicitar:
        </p>
        <Bullets
          items={[
            "confirmação da existência de tratamento e acesso aos dados;",
            "correção de dados incompletos, inexatos ou desatualizados;",
            "eliminação, bloqueio ou anonimização de dados desnecessários ou tratados em desconformidade, quando aplicável;",
            "portabilidade, nos termos da regulamentação;",
            "informação sobre com quem compartilhamos seus dados;",
            "oposição a tratamentos baseados em legítimo interesse, como mensuração de marketing.",
          ]}
        />
        <p>
          Para exercer esses direitos, use o canal indicado na seção Contato. Você também pode
          apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies e armazenamento local",
    body: (
      <p>
        Os detalhes estão na{" "}
        <Link to="/politica-de-cookies" className="text-primary underline">
          Política de Cookies
        </Link>
        .
      </p>
    ),
  },
];

function PrivacyPolicy() {
  return (
    <PolicyLayout
      path={PATH}
      title="Política de Privacidade"
      intro={
        <p>
          Esta política descreve como a Livraria Cultura trata dados pessoais de quem visita a loja
          e faz compras, conforme a Lei Geral de Proteção de Dados (LGPD).
        </p>
      }
      sections={sections}
    />
  );
}
