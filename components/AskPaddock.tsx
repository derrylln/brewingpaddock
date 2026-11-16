"use client";

import { useEffect, useRef, useState } from "react";
import type { AskAnswer } from "@/lib/knowledge";

type Message = {
  id: number;
  role: "user" | "bot";
  text: string;
  table?: AskAnswer["table"];
  bullets?: string[];
  citations?: string[];
  suggestions?: string[];
  source?: "ai" | "model";
};

const INTRO: Message = {
  id: 0,
  role: "bot",
  text:
    "I answer from the data this desk already holds: the live 2026 championship, every race classification, sector times from the latest telemetry session and a rulebook digest. If I cannot ground an answer, I will say so.",
  citations: ["Jolpica F1 API", "OpenF1 telemetry", "FIA rules digest"],
  suggestions: [
    "Who leads the championship?",
    "Who won in Brazil?",
    "Fastest sector 2 in the last race?",
    "What are the tyre rules?",
  ],
};

export default function AskPaddock() {
  const [messages, setMessages] = useState<Message[]>([INTRO]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, busy]);

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    const userMessage: Message = { id: Date.now(), role: "user", text: trimmed };
    setMessages((current) => [...current, userMessage]);
    setValue("");
    setBusy(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (!res.ok) throw new Error("offline");
      const answer = (await res.json()) as AskAnswer;
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "bot",
          text: answer.answer,
          table: answer.table,
          bullets: answer.bullets,
          citations: answer.citations,
          suggestions: answer.suggestions,
          source: answer.source,
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 2,
          role: "bot",
          text: "The data layer did not answer that one. Try again in a moment, or ask about the championship, a race result or a rule.",
          citations: [],
          suggestions: ["Who leads the championship?", "Who won the last race?"],
        },
      ]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="chat-shell">
      <div className="chat-main panel">
        <div className="chat-log" ref={logRef} aria-live="polite">
          {messages.map((message) => (
            <div key={message.id} className={`msg msg-${message.role}`}>
              <span className="mono msg-role">
                {message.role === "user" ? "YOU" : "DESK"}
                {message.role === "bot" && message.source === "ai" ? (
                  <i className="ai-dot" title="Written by Gemini from the grounded facts" />
                ) : null}
              </span>
              <div className="msg-body">
                <p className="msg-text">{message.text}</p>

                {message.bullets && message.bullets.length > 0 ? (
                  <ul className="msg-bullets">
                    {message.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}

                {message.table ? (
                  <div className="msg-table-wrap">
                    <table className="data-table msg-table">
                      <thead>
                        <tr>
                          {message.table.columns.map((column) => (
                            <th key={column} className={column === "Pos" ? "" : ""}>
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {message.table.rows.map((row, index) => (
                          <tr key={index}>
                            {row.map((cell, cellIndex) => (
                              <td key={cellIndex} className={cellIndex === 0 ? "mono" : ""}>
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {message.citations && message.citations.length > 0 ? (
                  <div className="msg-citations mono">
                    {message.citations.map((citation) => (
                      <span key={citation}>↳ {citation}</span>
                    ))}
                  </div>
                ) : null}

                {message.suggestions && message.suggestions.length > 0 ? (
                  <div className="msg-suggestions">
                    {message.suggestions.map((suggestion) => (
                      <button
                        type="button"
                        className="chip chip-ghost"
                        key={suggestion}
                        onClick={() => ask(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {busy ? (
            <div className="msg msg-bot">
              <span className="mono msg-role">DESK</span>
              <div className="msg-body">
                <span className="typing">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            </div>
          ) : null}
        </div>

        <form
          className="chat-input"
          onSubmit={(event) => {
            event.preventDefault();
            ask(value);
          }}
        >
          <input
            ref={inputRef}
            className="input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Ask about standings, a race, sector times or the rules…"
            aria-label="Ask the paddock desk"
            maxLength={300}
          />
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
            {busy ? "Working" : "Ask"}
          </button>
        </form>
      </div>

      <aside className="chat-aside">
        <div className="panel">
          <div className="panel-head">
            <h3>What it can answer</h3>
            <span className="mono">grounded</span>
          </div>
          <ul className="aside-list">
            <li>Championship order and points gaps</li>
            <li>Any 2026 race winner and podium</li>
            <li>Season win and podium counts</li>
            <li>Sector times from the telemetry archive</li>
            <li>Rules: tyres, points, sprints, safety cars, aero</li>
            <li>The next round and what is left</li>
          </ul>
        </div>
        <div className="panel">
          <div className="panel-head">
            <h3>How it works</h3>
            <span className="mono">retrieval first</span>
          </div>
          <p className="aside-copy">
            Every question is matched against the desk&apos;s own data layer before an answer is
            composed: live standings, the full season archive, the telemetry fixture and a curated
            regulations digest. Answers cite the source they came from, and unsupported questions are
            refused instead of invented.
          </p>
        </div>
        <div className="aside-stamp">
          <span className="serif">Paddock 101</span>
          <span className="mono">Ask properly. Answer honestly.</span>
        </div>
      </aside>
    </div>
  );
}
