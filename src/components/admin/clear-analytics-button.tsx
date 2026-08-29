import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

import { analyticsPurge, analyticsPurgePreview } from "@/lib/analytics.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Preview = Awaited<ReturnType<typeof analyticsPurgePreview>>;

/** Ação destrutiva restrita ao admin: limpa analytics da loja selecionada. */
export function ClearAnalyticsButton({ storeId }: { storeId: string | null }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);

  async function openDialog() {
    if (!storeId) {
      toast.error("Selecione uma loja específica para limpar o analytics.");
      return;
    }
    setOpen(true);
    setConfirm("");
    setPreview(null);
    setLoading(true);
    try {
      setPreview(await analyticsPurgePreview({ data: { storeId } }));
    } catch {
      toast.error("Não foi possível carregar a prévia da limpeza.");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function run() {
    if (!storeId || confirm !== "LIMPAR") return;
    setWorking(true);
    try {
      const result = await analyticsPurge({ data: { storeId, confirm: "LIMPAR" } });
      toast.success(`Analytics de ${result.storeSlug} limpo (${result.total} registros).`);
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["admin", "analytics"] });
    } catch {
      toast.error("Falha ao limpar o analytics.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Button variant="destructive" onClick={() => void openDialog()}>
        <Trash2 className="size-4" /> Limpar analytics
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tem certeza?</DialogTitle>
            <DialogDescription>
              Isso apagará os dados de analytics da loja selecionada.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Calculando registros…
            </div>
          ) : preview ? (
            <div className="space-y-3 text-sm">
              <p>
                Loja: <strong>{preview.storeName}</strong>{" "}
                <span className="text-muted-foreground">({preview.storeSlug})</span>
              </p>
              <ul className="space-y-1 rounded-md border p-3">
                {preview.tables.map((row) => (
                  <li key={row.table} className="flex justify-between gap-4">
                    <span className="font-mono text-xs">{row.table}</span>
                    <span className="tabular-nums">{row.rows}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Preservado sem alteração: {preview.preserved.join(", ")} e qualquer dado financeiro.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="purge-confirm">
                  Digite LIMPAR para confirmar
                </label>
                <Input
                  id="purge-confirm"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="LIMPAR"
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={working}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => void run()}
              disabled={working || confirm !== "LIMPAR"}
            >
              {working ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Limpar definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
