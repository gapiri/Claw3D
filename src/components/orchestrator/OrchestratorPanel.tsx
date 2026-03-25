"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrchestratorStatus {
  status: string;
  node?: string;
  agents?: number;
  uptime?: number;
  version?: string;
  [key: string]: unknown;
}

interface TmuxWindow {
  id?: string | number;
  name?: string;
  window?: string;
  session?: string;
  panes?: number;
  active?: boolean;
  [key: string]: unknown;
}

interface OrchestratorTask {
  id: string;
  type?: string;
  status?: string;
  agent?: string;
  payload?: unknown;
  created_at?: string;
  [key: string]: unknown;
}

interface WsEvent {
  type?: string;
  event?: string;
  payload?: unknown;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:4000";
const WS_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_WS ??
  "ws://localhost:4000/ws/orchestrator?role=viewer&id=Claw3D";

const POLL_INTERVAL_MS = 6000;
const WS_RECONNECT_MS = 3000;

// ---------------------------------------------------------------------------
// Small UI primitives (no external deps — only Tailwind)
// ---------------------------------------------------------------------------

function Badge({
  label,
  color = "cyan",
}: {
  label: string;
  color?: "cyan" | "green" | "amber" | "red" | "fuchsia" | "slate";
}) {
  const colorMap: Record<string, string> = {
    cyan: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
    green: "border-green-500/40 bg-green-500/10 text-green-300",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    red: "border-red-500/40 bg-red-500/10 text-red-300",
    fuchsia: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
    slate: "border-white/15 bg-white/5 text-white/50",
  };
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] ${colorMap[color] ?? colorMap.slate}`}
    >
      {label}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.28em] text-white/40">
      {children}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded border border-white/8 bg-white/[0.03] p-3 ${className}`}>
      {children}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled = false,
  variant = "default",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "success";
}) {
  const variantMap: Record<string, string> = {
    default:
      "border-cyan-500/25 bg-cyan-500/8 text-cyan-300 hover:border-cyan-400/50 hover:text-cyan-100",
    danger:
      "border-red-500/25 bg-red-500/8 text-red-300 hover:border-red-400/50 hover:text-red-100",
    success:
      "border-green-500/25 bg-green-500/8 text-green-300 hover:border-green-400/50 hover:text-green-100",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variantMap[variant] ?? variantMap.default}`}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// WebSocket hook
// ---------------------------------------------------------------------------

function useOrchestratorWs(onEvent: (ev: WsEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [wsStatus, setWsStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    setWsStatus("connecting");
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (mountedRef.current) setWsStatus("open");
      };

      ws.onmessage = (msg) => {
        if (!mountedRef.current) return;
        try {
          const data: WsEvent = JSON.parse(msg.data as string);
          onEvent(data);
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setWsStatus("closed");
        reconnectTimer.current = setTimeout(connect, WS_RECONNECT_MS);
      };
    } catch {
      setWsStatus("closed");
      reconnectTimer.current = setTimeout(connect, WS_RECONNECT_MS);
    }
  }, [onEvent]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return wsStatus;
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function OrchestratorPanel() {
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [tmux, setTmux] = useState<TmuxWindow[]>([]);
  const [tasks, setTasks] = useState<OrchestratorTask[]>([]);
  const [events, setEvents] = useState<WsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Task-send form state
  const [taskType, setTaskType] = useState("shell");
  const [taskAgent, setTaskAgent] = useState("");
  const [taskPayload, setTaskPayload] = useState("");
  const [taskSending, setTaskSending] = useState(false);
  const [taskResult, setTaskResult] = useState<string | null>(null);

  // Android / screenshot
  const [adbSending, setAdbSending] = useState(false);

  const eventsRef = useRef<HTMLDivElement>(null);

  // --- WS events ----------------------------------------------------------
  const handleWsEvent = useCallback((ev: WsEvent) => {
    setEvents((prev) => [ev, ...prev].slice(0, 60));
  }, []);

  const wsStatus = useOrchestratorWs(handleWsEvent);

  // Auto-scroll events list
  useEffect(() => {
    if (eventsRef.current) {
      eventsRef.current.scrollTop = 0;
    }
  }, [events]);

  // --- Polling ------------------------------------------------------------
  const fetchAll = useCallback(async () => {
    try {
      const [statusRes, tmuxRes, tasksRes] = await Promise.allSettled([
        fetch(`${BASE}/v1/orchestrator/status`),
        fetch(`${BASE}/v1/orchestrator/tmux`),
        fetch(`${BASE}/v1/orchestrator/tasks?status=queued`),
      ]);

      if (statusRes.status === "fulfilled" && statusRes.value.ok) {
        const data: OrchestratorStatus = await statusRes.value.json();
        setStatus(data);
      }
      if (tmuxRes.status === "fulfilled" && tmuxRes.value.ok) {
        const data: unknown = await tmuxRes.value.json();
        setTmux(Array.isArray(data) ? (data as TmuxWindow[]) : []);
      }
      if (tasksRes.status === "fulfilled" && tasksRes.value.ok) {
        const data: unknown = await tasksRes.value.json();
        setTasks(Array.isArray(data) ? (data as OrchestratorTask[]) : []);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  // --- Actions ------------------------------------------------------------
  const sendTask = useCallback(async () => {
    if (!taskType) return;
    setTaskSending(true);
    setTaskResult(null);
    try {
      let parsedPayload: unknown = taskPayload;
      try {
        parsedPayload = JSON.parse(taskPayload);
      } catch {
        // use as plain string
      }
      const res = await fetch(`${BASE}/v1/orchestrator/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: taskType,
          agent: taskAgent || undefined,
          payload: parsedPayload || undefined,
        }),
      });
      const text = await res.text();
      setTaskResult(res.ok ? `OK: ${text}` : `Error ${res.status}: ${text}`);
      if (res.ok) fetchAll();
    } catch (err) {
      setTaskResult(`Error: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setTaskSending(false);
    }
  }, [taskType, taskAgent, taskPayload, fetchAll]);

  const sendAndroid = useCallback(async (action: "screenshot") => {
    setAdbSending(true);
    try {
      await fetch(`${BASE}/v1/orchestrator/android`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } catch {
      // best-effort
    } finally {
      setAdbSending(false);
    }
  }, []);

  const spawnTeam = useCallback(
    async (teamName: string) => {
      setTaskSending(true);
      try {
        await fetch(`${BASE}/v1/orchestrator/task`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "spawn_team", payload: { team: teamName } }),
        });
        fetchAll();
      } catch {
        // best-effort
      } finally {
        setTaskSending(false);
      }
    },
    [fetchAll],
  );

  // --- Render helpers -----------------------------------------------------
  const wsColor: "green" | "amber" | "red" =
    wsStatus === "open" ? "green" : wsStatus === "connecting" ? "amber" : "red";

  const statusColor: "green" | "amber" | "red" =
    status?.status === "ok" || status?.status === "running" ? "green" : "amber";

  // ---------------------------------------------------------------------------
  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#06090d] text-white">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 py-3">
        <div>
          <div className="font-mono text-[13px] font-semibold tracking-[0.12em] text-white/90">
            ORCHESTRATOR
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-white/35">Nova Go · localhost:4000</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge label={`WS ${wsStatus}`} color={wsColor} />
          {status && <Badge label={status.status ?? "unknown"} color={statusColor} />}
          <button
            type="button"
            onClick={fetchAll}
            className="rounded border border-white/10 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.16em] text-white/40 transition-colors hover:border-white/25 hover:text-white/70"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loading && !status && (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-cyan-400" />
          </div>
        )}

        {error && (
          <Card className="mb-4 border-red-500/25 bg-red-500/5">
            <div className="font-mono text-[10px] text-red-300">
              Connection error: {error} — is Nova Go running on :4000?
            </div>
          </Card>
        )}

        {/* System Status */}
        {status && (
          <section className="mb-5">
            <SectionTitle>System Status</SectionTitle>
            <Card>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(
                  Object.entries(status).filter(
                    ([k]) => !["status"].includes(k),
                  ) as [string, unknown][]
                ).map(([key, val]) => (
                  <div key={key} className="min-w-0">
                    <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/35">
                      {key}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-white/80">
                      {String(val ?? "—")}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        {/* Tmux windows */}
        <section className="mb-5">
          <SectionTitle>Tmux Sessions ({tmux.length})</SectionTitle>
          {tmux.length === 0 ? (
            <Card>
              <span className="font-mono text-[10px] text-white/30">No sessions reported</span>
            </Card>
          ) : (
            <div className="flex flex-col gap-1.5">
              {tmux.map((win, i) => {
                const label =
                  win.name ?? win.window ?? win.session ?? `window-${i}`;
                return (
                  <Card key={i} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-[11px] text-white/80">{label}</div>
                      {win.session && win.name !== win.session && (
                        <div className="font-mono text-[9px] text-white/35">{win.session}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {win.active && <Badge label="active" color="green" />}
                      {win.panes !== undefined && (
                        <Badge label={`${win.panes}p`} color="slate" />
                      )}
                      <ActionButton
                        label="Spawn"
                        onClick={() => spawnTeam(String(label))}
                        disabled={taskSending}
                      />
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* Queued Tasks */}
        <section className="mb-5">
          <SectionTitle>Queued Tasks ({tasks.length})</SectionTitle>
          {tasks.length === 0 ? (
            <Card>
              <span className="font-mono text-[10px] text-white/30">Queue empty</span>
            </Card>
          ) : (
            <div className="flex flex-col gap-1.5">
              {tasks.map((task) => (
                <Card key={task.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-mono text-[10px] text-white/70">
                      {task.id}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {task.type && <Badge label={task.type} color="fuchsia" />}
                      {task.status && <Badge label={task.status} color="amber" />}
                    </div>
                  </div>
                  {task.agent && (
                    <div className="font-mono text-[9px] text-white/35">agent: {task.agent}</div>
                  )}
                  {task.created_at && (
                    <div className="font-mono text-[9px] text-white/25">{task.created_at}</div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Send Task */}
        <section className="mb-5">
          <SectionTitle>Send Task</SectionTitle>
          <Card className="flex flex-col gap-2">
            <div className="flex flex-col gap-1.5 sm:flex-row">
              <div className="flex flex-1 flex-col gap-1">
                <label className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
                  Type
                </label>
                <input
                  value={taskType}
                  onChange={(e) => setTaskType(e.target.value)}
                  placeholder="shell / spawn_team / screenshot…"
                  className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 font-mono text-[11px] text-white/80 outline-none placeholder:text-white/20 focus:border-cyan-500/40"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <label className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
                  Agent (optional)
                </label>
                <input
                  value={taskAgent}
                  onChange={(e) => setTaskAgent(e.target.value)}
                  placeholder="sofia / luna / lead…"
                  className="w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 font-mono text-[11px] text-white/80 outline-none placeholder:text-white/20 focus:border-cyan-500/40"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
                Payload (JSON or text)
              </label>
              <textarea
                value={taskPayload}
                onChange={(e) => setTaskPayload(e.target.value)}
                placeholder='{"cmd":"ls -la"}'
                rows={3}
                className="w-full resize-none rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 font-mono text-[10px] text-white/80 outline-none placeholder:text-white/20 focus:border-cyan-500/40"
              />
            </div>
            <div className="flex items-center gap-2">
              <ActionButton
                label={taskSending ? "Sending…" : "Send Task"}
                onClick={sendTask}
                disabled={taskSending || !taskType}
                variant="success"
              />
              {taskResult && (
                <span
                  className={`font-mono text-[10px] ${taskResult.startsWith("OK") ? "text-green-300" : "text-red-300"}`}
                >
                  {taskResult}
                </span>
              )}
            </div>
          </Card>
        </section>

        {/* Quick Actions */}
        <section className="mb-5">
          <SectionTitle>Quick Actions</SectionTitle>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              label="ADB Screenshot"
              onClick={() => sendAndroid("screenshot")}
              disabled={adbSending}
            />
            <ActionButton
              label="Screenshot"
              onClick={() => {
                setTaskType("screenshot");
                setTaskPayload("");
                sendTask();
              }}
              disabled={taskSending}
            />
            <ActionButton
              label="Spawn Team"
              onClick={() => {
                setTaskType("spawn_team");
                setTaskPayload('{"team":"nova"}');
                sendTask();
              }}
              disabled={taskSending}
            />
          </div>
        </section>

        {/* Live WS Events */}
        <section className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <SectionTitle>Live Events</SectionTitle>
            {events.length > 0 && (
              <button
                type="button"
                onClick={() => setEvents([])}
                className="font-mono text-[9px] text-white/25 hover:text-white/50"
              >
                Clear
              </button>
            )}
          </div>
          <div
            ref={eventsRef}
            className="max-h-52 overflow-y-auto rounded border border-white/8 bg-black/30 p-2"
          >
            {events.length === 0 ? (
              <div className="font-mono text-[10px] text-white/25">
                Waiting for WS events…
              </div>
            ) : (
              events.map((ev, i) => (
                <div
                  key={i}
                  className="border-b border-white/5 py-1 font-mono text-[9px] text-white/55 last:border-0"
                >
                  <span className="text-cyan-400/60">{ev.type ?? ev.event ?? "event"}</span>
                  {"  "}
                  <span className="text-white/35">
                    {JSON.stringify(ev.payload ?? ev, null, 0).slice(0, 120)}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
