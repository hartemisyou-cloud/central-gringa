import { PolicyLinks } from "@/components/policies/PolicyLinks";
import { createFileRoute } from "@tanstack/react-router";
import { Download, BookOpen, FileText, Globe } from "lucide-react";
import cover from "@/assets/el-silencio-del-mar-cover.jpg";

const PDF_URL =
  "/__l5e/assets-v1/3df90f85-5254-43b1-9c4f-a8ca4877382a/El_silencio_del_mar_-_Vercors.pdf";
const PDF_FILENAME = "El_silencio_del_mar_-_Vercors.pdf";

export const Route = createFileRoute("/livro/el-silencio-del-mar")({
  head: () => ({
    meta: [
      { title: "El Silencio del Mar — Vercors | Download do eBook" },
      {
        name: "description",
        content:
          "Baixe o eBook El Silencio del Mar, de Vercors. Edição digital em PDF da Livraria Cultura.",
      },
      { property: "og:title", content: "El Silencio del Mar — Vercors" },
      {
        property: "og:description",
        content:
          "Baixe o eBook El Silencio del Mar, de Vercors. Edição digital em PDF da Livraria Cultura.",
      },
      { property: "og:type", content: "book" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BookDownloadPage,
});

function BookDownloadPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-3xl">
        <div className="grid md:grid-cols-[280px_1fr] gap-8 items-center rounded-2xl border border-border bg-card p-6 md:p-10 shadow-lg">
          <div className="mx-auto w-full max-w-[280px]">
            <img
              src={cover}
              alt="Capa do livro El Silencio del Mar, de Vercors"
              width={768}
              height={1152}
              className="w-full h-auto rounded-lg shadow-xl"
            />
          </div>

          <div className="text-center md:text-left space-y-5">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                Livraria Cultura · eBook
              </p>
              <h1 className="font-serif text-3xl md:text-4xl font-bold text-foreground leading-tight">
                El Silencio del Mar
              </h1>
              <p className="mt-2 text-lg text-muted-foreground">Vercors</p>
            </div>

            <p className="text-sm text-muted-foreground leading-relaxed">
              Clássico da literatura francesa escrito durante a ocupação da
              França na Segunda Guerra Mundial. Uma história de silêncio,
              resistência e humanidade.
            </p>

            <div className="flex flex-wrap justify-center md:justify-start gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Formato PDF
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Espanhol
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5" /> Edição digital
              </span>
            </div>

            <a
              href={PDF_URL}
              download={PDF_FILENAME}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3.5 text-base font-semibold text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Download className="h-5 w-5" />
              Baixar eBook (PDF)
            </a>

            <p className="text-xs text-muted-foreground">
              Ao clicar, o arquivo PDF será baixado diretamente para o seu
              dispositivo.
            </p>
          </div>
        </div>
      </div>
      <PolicyLinks className="mt-10 text-muted-foreground" />
    </div>
  );
}
