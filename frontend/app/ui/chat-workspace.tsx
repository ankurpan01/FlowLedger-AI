"use client";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, Forecast } from "@/lib/api";
import { useWorkspace } from "./workspace-provider";
import Proposal, { ProposalData } from "./proposal";
import { ForecastResult } from "./forecast-panel";
type Event =
  | ProposalData
  | { type: "message"; text: string }
  | { type: "tool_call"; name: string; inputs: Record<string, unknown> }
  | { type: "result"; data: Record<string, unknown>; status: string };
type Turn = {
  id: string;
  request_id: string;
  message: string;
  events: Event[];
  status: string;
  created_at: string;
};
type Conversation = { id: string; title: string };
export default function ChatWorkspace({
  compact = false,
}: {
  compact?: boolean;
}) {
  const store = useWorkspace(),
    [conversations, setConversations] = useState<Conversation[]>([]),
    [conversation, setConversation] = useState(""),
    [turns, setTurns] = useState<Turn[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<{
      id: string;
      message: string;
      conversation: string;
    } | null>(null),
    bottom = useRef<HTMLDivElement>(null);
  const loadList = useCallback(async () => {
    const r = await api<{ conversations: Conversation[] }>("/conversations");
    setConversations(r.conversations);
    return r.conversations;
  }, []);
  const open = useCallback(async (id: string) => {
    const r = await api<{ turns: Turn[] }>(`/conversations/${id}`);
    setConversation(id);
    setTurns(r.turns);
    localStorage.setItem("flowledger-current-chat", id);
  }, []);
  useEffect(() => {
    if (!store.workspace) return;
    let active = true;
    (async () => {
      try {
        const list = await loadList();
        const saved = localStorage.getItem("flowledger-current-chat");
        const id = list.find((c) => c.id === saved)?.id || list[0]?.id;
        if (active && id) await open(id);
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : "Could not load conversations.",
          );
      }
    })();
    return () => {
      active = false;
    };
  }, [store.workspace, loadList, open]);
  async function newChat() {
    setError("");
    setBusy(true);
    try {
      const chat = await api<Conversation>("/conversations", {
        method: "POST",
      });
      setConversation(chat.id);
      setTurns([]);
      localStorage.setItem("flowledger-current-chat", chat.id);
      pending.current = null;
      await loadList();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not create conversation.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || !message.trim() || !store.workspace) return;
    setBusy(true);
    setError("");
    try {
      let id = conversation;
      if (!id) {
        const c = await api<Conversation>("/conversations", { method: "POST" });
        id = c.id;
        setConversation(id);
        localStorage.setItem("flowledger-current-chat", id);
      }
      if (
        !pending.current ||
        pending.current.message !== message ||
        pending.current.conversation !== id
      )
        pending.current = {
          id: crypto.randomUUID(),
          message,
          conversation: id,
        };
      const request = pending.current;
      await api(`/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: request.message,
          request_id: request.id,
          conversation_id: id,
        }),
      });
      await open(id);
      await loadList();
      setMessage("");
      pending.current = null;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Gemini could not respond. Your conversation is preserved.",
      );
      if (conversation) await open(conversation).catch(() => {});
    } finally {
      setBusy(false);
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
  return (
    <section className={compact ? "card chat-card compact" : "card chat-card"}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Your financial copilot</p>
          <h2>Ask Gemini</h2>
        </div>
        {compact ? (
          <Link href="/assistant" className="text-link">
            Open workspace ↗
          </Link>
        ) : (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void newChat()}
          >
            + New conversation
          </button>
        )}
      </div>
      <p className="muted">
        Explore real spending, plan your budget, and review changes before
        saving.
      </p>
      <div className={compact ? "" : "conversation-layout"}>
        {!compact && (
          <aside
            className="conversation-list"
            aria-label="Previous conversations"
          >
            {conversations.map((c) => (
              <button
                key={c.id}
                disabled={busy}
                className={
                  c.id === conversation ? "conversation active" : "conversation"
                }
                onClick={() =>
                  void open(c.id).catch((e) => setError(e.message))
                }
              >
                {c.title}
              </button>
            ))}
            {!conversations.length && (
              <p className="muted">Your conversations will appear here.</p>
            )}
          </aside>
        )}
        <div>
          <div className="chat-messages" aria-live="polite">
            {(compact ? turns.slice(-1) : turns).map((turn) => (
              <article key={turn.id} className="chat-turn">
                <p className="user-message">{turn.message}</p>
                {turn.status === "failed" && (
                  <p className="muted">
                    This request did not complete. You can retry it.
                  </p>
                )}
                {turn.events.map((event, i) =>
                  event.type === "message" ? (
                    <p key={i} className="assistant-message">
                      {event.text}
                    </p>
                  ) : event.type === "tool_call" ? (
                    <details key={i} className="tool-activity">
                      <summary>Used {event.name.replaceAll("_", " ")}</summary>
                      <pre>{JSON.stringify(event.inputs, null, 2)}</pre>
                    </details>
                  ) : event.type === "proposal" ? (
                    <Proposal
                      key={i}
                      proposal={event}
                      confirmationKey={`confirm-${turn.id}`}
                      onDone={() => void open(conversation)}
                    />
                  ) : event.type === "result" && event.data.forecast ? (
                    <ForecastResult
                      key={i}
                      forecast={event.data.forecast as Forecast}
                    />
                  ) : event.type === "result" ? (
                    <details key={i} className="tool-activity">
                      <summary>View grounded financial result</summary>
                      <pre>{JSON.stringify(event.data, null, 2)}</pre>
                    </details>
                  ) : null,
                )}
              </article>
            ))}
            {!turns.length && (
              <div className="chat-empty">
                <span aria-hidden="true">✧</span>
                <p>What would you like to understand?</p>
                <div className="prompt-chips">
                  {[
                    "Show my largest expenses in September 2026.",
                    "Set my Groceries budget to $300.",
                    "Will my Dining spending exceed its budget this month?",
                  ].map((p) => (
                    <button
                      className="secondary"
                      key={p}
                      onClick={() => setMessage(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div ref={bottom} />
          </div>
          <form onSubmit={send} className="chat-compose">
            <label className="sr-only" htmlFor="chat-message">
              Your request
            </label>
            <textarea
              id="chat-message"
              value={message}
              maxLength={2000}
              disabled={busy || !store.workspace}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask about your spending, or tell Gemini what to change…"
              rows={2}
            />
            <button
              className="primary"
              disabled={busy || !message.trim() || !store.workspace}
            >
              {busy ? "Thinking…" : error ? "Retry request" : "Ask Gemini"}
            </button>
          </form>
          {busy && (
            <p role="status" className="muted">
              Gemini is using your workspace tools. Your history will be saved.
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p className="fine-print">
            Last five completed turns provide bounded context. Reopen any saved
            conversation.{" "}
            <Link href="/documents">Attach a statement through Documents</Link>.
          </p>
        </div>
      </div>
    </section>
  );
}
