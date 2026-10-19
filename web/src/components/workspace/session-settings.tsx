"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { authClient } from "@/lib/auth-client";
import { MonitorIcon, SmartphoneIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type Session = NonNullable<
  Awaited<ReturnType<typeof authClient.listSessions>>["data"]
>[number];
type SessionDisplay = Session & {
  createdAtLabel: string;
  expiresAtLabel: string;
};

const sessionDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

async function loadSessions() {
  const [listed, current] = await Promise.all([
    authClient.listSessions(),
    authClient.getSession(),
  ]);
  if (listed.error || current.error || !listed.data || !current.data?.session)
    throw Error("Could not load your sessions.");

  const sessions = listed.data.map((session) => ({
    ...session,
    createdAtLabel: sessionDateTime.format(new Date(session.createdAt)),
    expiresAtLabel: sessionDateTime.format(new Date(session.expiresAt)),
  }));

  return { sessions, currentId: current.data.session.id };
}

function deviceName(userAgent: string | null | undefined) {
  if (!userAgent) return "Unknown device";

  const browser = /Edg\/|EdgiOS/.test(userAgent)
    ? "Edge"
    : /Firefox\/|FxiOS/.test(userAgent)
      ? "Firefox"
      : /Chrome\/|CriOS/.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const system = /iPhone|iPad/.test(userAgent)
    ? "iPhone or iPad"
    : /Android/.test(userAgent)
      ? "Android"
      : /Macintosh|Mac OS X/.test(userAgent)
        ? "Mac"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "device";

  return `${browser} on ${system}`;
}

function SessionList({
  sessions,
  currentId,
  loading,
  loadError,
  pending,
  onRefresh,
  onRevoke,
  onRevokeOthers,
}: {
  sessions: SessionDisplay[];
  currentId: string;
  loading: boolean;
  loadError: boolean;
  pending: string;
  onRefresh: () => void;
  onRevoke: (session: SessionDisplay) => void;
  onRevokeOthers: () => void;
}) {
  const ordered = [...sessions].sort(
    (a, b) =>
      Number(b.id === currentId) - Number(a.id === currentId) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <section className="mt-6" aria-labelledby="active-sessions-heading">
      <SessionListHeader
        count={sessions.length}
        otherCount={
          sessions.filter((session) => session.id !== currentId).length
        }
        loading={loading}
        loadError={loadError}
        pending={pending}
        onRevokeOthers={onRevokeOthers}
      />
      <SessionListContent
        sessions={ordered}
        currentId={currentId}
        loading={loading}
        loadError={loadError}
        pending={pending}
        onRefresh={onRefresh}
        onRevoke={onRevoke}
      />
    </section>
  );
}

function SessionListHeader({
  count,
  otherCount,
  loading,
  loadError,
  pending,
  onRevokeOthers,
}: {
  count: number;
  otherCount: number;
  loading: boolean;
  loadError: boolean;
  pending: string;
  onRevokeOthers: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h3 id="active-sessions-heading" className="font-medium">
          Active sessions
        </h3>
        {!loading && !loadError && (
          <p className="mt-1 text-sm text-muted-foreground">
            {count} active {count === 1 ? "session" : "sessions"}
          </p>
        )}
      </div>
      {!loadError && otherCount > 0 && (
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={onRevokeOthers}
          disabled={Boolean(pending) || loading}
        >
          {pending === "others" ? "Signing out…" : "Sign out other devices"}
        </Button>
      )}
    </div>
  );
}

function SessionListContent({
  sessions,
  currentId,
  loading,
  loadError,
  pending,
  onRefresh,
  onRevoke,
}: {
  sessions: SessionDisplay[];
  currentId: string;
  loading: boolean;
  loadError: boolean;
  pending: string;
  onRefresh: () => void;
  onRevoke: (session: SessionDisplay) => void;
}) {
  if (loading) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <p role="status" className="text-sm text-muted-foreground">
          Loading sessions…
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mt-6 flex flex-col items-start gap-3">
        <Alert variant="destructive">
          <AlertDescription>
            Could not load your sessions. Please try again.
          </AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Try again
        </Button>
      </div>
    );
  }

  if (!sessions.length) {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        No active sessions found.
      </p>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          current={session.id === currentId}
          pending={pending}
          onRevoke={onRevoke}
        />
      ))}
    </div>
  );
}

function SessionRow({
  session,
  current,
  pending,
  onRevoke,
}: {
  session: SessionDisplay;
  current: boolean;
  pending: string;
  onRevoke: (session: SessionDisplay) => void;
}) {
  const mobile = /iPhone|iPad|Android/i.test(session.userAgent ?? "");
  const Icon = mobile ? SmartphoneIcon : MonitorIcon;

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b pb-4 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{deviceName(session.userAgent)}</p>
          {current && <Badge variant="secondary">This device</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in {session.createdAtLabel} · Expires {session.expiresAtLabel}
        </p>
      </div>
      {!current && (
        <Button
          variant="outline"
          size="sm"
          className="col-start-2 justify-self-start text-destructive hover:text-destructive sm:col-start-3 sm:row-start-1"
          disabled={Boolean(pending)}
          onClick={() => onRevoke(session)}
          aria-label={`Sign out ${deviceName(session.userAgent)} session from ${session.createdAtLabel}`}
        >
          {pending === session.id ? "Signing out…" : "Sign out"}
        </Button>
      )}
    </div>
  );
}

export function SessionSettings() {
  const [sessions, setSessions] = useState<SessionDisplay[]>([]);
  const [currentId, setCurrentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadSessions();
      setSessions(result.sessions);
      setCurrentId(result.currentId);
      setLoadError(false);

      return true;
    } catch {
      setLoadError(true);

      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void loadSessions()
      .then((result) => {
        if (!active) return;

        setSessions(result.sessions);
        setCurrentId(result.currentId);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function revoke(session: SessionDisplay) {
    if (session.id === currentId || pending) return;

    setPending(session.id);
    try {
      const result = await authClient.revokeSession({ id: session.id });
      if (result.error) throw Error("Could not sign out that device.");

      if (await refresh()) toast.success("Device signed out.");
    } catch {
      toast.error("Could not sign out that device. Please try again.");
    } finally {
      setPending("");
    }
  }

  async function revokeOthers() {
    if (pending) return;

    setPending("others");
    try {
      const result = await authClient.revokeOtherSessions();
      if (result.error) throw Error("Could not sign out your other devices.");

      if (await refresh()) toast.success("Other devices signed out.");
    } catch {
      toast.error("Could not sign out your other devices. Please try again.");
    } finally {
      setPending("");
    }
  }

  return (
    <>
      <h2 id="settings-section-title" className="text-lg font-semibold">
        Authentication
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        See where you’re signed in and end sessions you no longer use.
      </p>
      <SessionList
        sessions={sessions}
        currentId={currentId}
        loading={loading}
        loadError={loadError}
        pending={pending}
        onRefresh={() => void refresh()}
        onRevoke={(session) => void revoke(session)}
        onRevokeOthers={() => void revokeOthers()}
      />
    </>
  );
}
