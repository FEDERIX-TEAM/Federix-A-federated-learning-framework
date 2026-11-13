"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { Field, TextArea } from "@/components/ui/Field";
import { useToast } from "@/components/toast";
import { describeError } from "@/lib/api";
import { useStopRound } from "@/lib/rounds";
import { validateStopReason } from "@/lib/roundView";

export function StopRoundDialog({ open, onClose, roundId, roundNumber, modelVersion }: { open: boolean; onClose: () => void; roundId: string; roundNumber: number; modelVersion: number }) {
  const toast = useToast();
  const stop = useStopRound();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validateStopReason(reason);
    setError(problem);
    if (problem) return;
    try {
      await stop.mutateAsync({ roundId, reason: reason.trim() });
      toast("ok", `Round ${roundNumber} stopped`);
      onClose();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={stop.isPending}
      tone="danger"
      title={`Stop round ${roundNumber}?`}
      description={`Every update in this round is rejected and nothing is aggregated. The global model stays at ${modelVersion ? `v${modelVersion}` : "its current version"}. This can't be undone.`}
      footer={
        <>
          <Button onClick={onClose} disabled={stop.isPending}>
            Keep running
          </Button>
          <Button variant="danger" type="submit" form="stop-round" loading={stop.isPending}>
            {stop.isPending ? null : <Square size={14} />}
            Stop round
          </Button>
        </>
      }
    >
      <form id="stop-round" onSubmit={onSubmit} noValidate>
        <Field label="Reason" error={error} hint="Recorded in the audit log and shown on the round.">
          {(p) => <TextArea {...p} data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. wrong configuration, restarting with mu = 0.05" />}
        </Field>
      </form>
    </Dialog>
  );
}
