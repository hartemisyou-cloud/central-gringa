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
      toast.error("Select a specific store to clear analytics.");
      return;
    }
    setOpen(true);
    setConfirm("");
    setPreview(null);
    setLoading(true);
    try {
      setPreview(await analyticsPurgePreview({ data: { storeId } }));
    } catch {
      toast.error("Could not load purge preview.");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function run() {
    if (!storeId || confirm !== "CLEAR") return;
    setWorking(true);
    try {
      const result = await analyticsPurge({ data: { storeId, confirm: "CLEAR" } });
      toast.success(`Analytics for ${result.storeSlug} cleared (${result.total} records).`);
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["admin", "analytics"] });
    } catch {
      toast.error("Failed to clear analytics.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <Button variant="destructive" onClick={() => void openDialog()}>
        <Trash2 className="size-4" /> Clear analytics
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Are you sure?</DialogTitle>
            <DialogDescription>
              This will delete analytics data for the selected store.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Calculating records…
            </div>
          ) : preview ? (
            <div className="space-y-3 text-sm">
              <p>
                Store: <strong>{preview.storeName}</strong>{" "}
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
                Preserved without change: {preview.preserved.join(", ")} and any financial data.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-medium" htmlFor="purge-confirm">
                  Type LIMPAR to confirm
                </label>
                <Input
                  id="purge-confirm"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="CLEAR"
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={working}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void run()}
              disabled={working || confirm !== "CLEAR"}
            >
              {working ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Permanently clear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
