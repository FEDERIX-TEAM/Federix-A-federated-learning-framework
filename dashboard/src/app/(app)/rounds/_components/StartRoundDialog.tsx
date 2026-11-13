"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { Chips, Field, TextArea, TextInput } from "@/components/ui/Field";
import { useToast } from "@/components/toast";
import { describeError } from "@/lib/api";
import { useAdminConfig, useStartRound } from "@/lib/rounds";
import { validateStart, type StartErrors } from "@/lib/roundView";

const DEADLINES = [
  { value: "5", label: "5 min" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hour" },
  { value: "240", label: "4 hours" },
];

export function StartRoundDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const config = useAdminConfig();
  const start = useStartRound();
  const [maxClients, setMaxClients] = useState("");
  const [deadlineMinutes, setDeadlineMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<StartErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !config.data) return;
    setMaxClients(String(Math.min(config.data.maxClientsPerRound, Math.max(config.data.minClientsPerRound, 10))));
    setDeadlineMinutes(String(Math.max(1, Math.round(config.data.maxRoundDurationSeconds / 60))));
    setNotes("");
    setErrors({});
    setServerError(null);
  }, [open, config.data]);

  const limits = config.data ? { minClients: config.data.minClientsPerRound, maxClients: config.data.maxClientsPerRound } : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!limits) return;
    const result = validateStart({ maxClients, deadlineMinutes, notes }, limits);
    setErrors(result.errors);
    if (!result.value) return;
    setServerError(null);
    try {
      const res = await start.mutateAsync(result.value);
      toast("ok", `Round ${res.roundNumber} started`, "Clients can join now.");
      onClose();
      router.push(`/rounds/${res.roundId}`);
    } catch (err) {
      setServerError(describeError(err));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={start.isPending}
      title="Start a round"
      description="Clients that are online join, train on their own data and send updates until the round fills up or the deadline passes."
      footer={
        <>
          <Button onClick={onClose} disabled={start.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="start-round" loading={start.isPending} disabled={!limits}>
            {start.isPending ? null : <Play size={15} />}
            Start round
          </Button>
        </>
      }
    >
      <form id="start-round" onSubmit={onSubmit} noValidate style={{ display: "grid", gap: 18 }}>
        {serverError ? (
          <p role="alert" style={{ color: "var(--bad)", background: "var(--bad-soft)", padding: "10px 12px", borderRadius: 10, fontSize: 13.5 }}>
            {serverError}
          </p>
        ) : null}
        <Field label="Maximum clients" error={errors.maxClients} hint={limits ? `Between ${limits.minClients} and ${limits.maxClients}. The round can finish early once this many updates arrive.` : "Loading limits…"}>
          {(p) => <TextInput {...p} data-autofocus inputMode="numeric" value={maxClients} onChange={(e) => setMaxClients(e.target.value)} />}
        </Field>
        <Field label="Deadline (minutes)" error={errors.deadlineMinutes} hint="When it passes, the round aggregates what it has, or is stopped if too few clients sent updates.">
          {(p) => (
            <div style={{ display: "grid", gap: 8 }}>
              <TextInput {...p} inputMode="decimal" value={deadlineMinutes} onChange={(e) => setDeadlineMinutes(e.target.value)} />
              <Chips label="Deadline presets" options={DEADLINES} value={DEADLINES.some((d) => d.value === deadlineMinutes) ? deadlineMinutes : null} onChange={setDeadlineMinutes} />
            </div>
          )}
        </Field>
        <Field label="Notes (optional)" error={errors.notes} hint={`${notes.length}/500 · shown in the round list`}>
          {(p) => <TextArea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What is this round for?" />}
        </Field>
      </form>
    </Dialog>
  );
}
