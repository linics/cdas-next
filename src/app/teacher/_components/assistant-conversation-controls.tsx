"use client";

import { useState } from "react";
import { HistoryIcon, SquarePenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LocalizedDateTime } from "../../_components/localized-date-time";
import type { AssistantConversationSummary } from "../../../server/assistant/assistant-conversations";
import { useActivityAssistantConversation } from "./activity-assistant";
import {
  listAssistantConversationsAction,
  openAssistantConversationAction,
} from "./assistant-conversation-actions";

/** D-099: start a new conversation or go back to a saved one. */
export function AssistantConversationControls() {
  const conversation = useActivityAssistantConversation();
  const [history, setHistory] = useState<AssistantConversationSummary[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const toggleHistory = async () => {
    if (history) {
      setHistory(null);
      return;
    }
    setNotice(null);
    setHistory(await listAssistantConversationsAction());
  };

  const open = async (id: string) => {
    setOpening(id);
    const restored = await openAssistantConversationAction(id);
    setOpening(null);
    if (!restored) {
      setNotice("这段对话是旧版本助手留下的，已经无法继续；可以开一段新对话。");
      return;
    }
    conversation.open({ id: restored.id, messages: restored.messages, updatedAt: restored.updatedAt });
    setHistory(null);
  };

  return (
    <div className="relative flex items-center gap-1">
      <Button
        aria-label="历史对话"
        aria-expanded={history !== null}
        disabled={conversation.busy}
        onClick={() => void toggleHistory()}
        size="icon"
        type="button"
        variant="ghost"
      >
        <HistoryIcon />
      </Button>
      <Button
        aria-label="新对话"
        disabled={conversation.busy || !conversation.hasMessages}
        onClick={() => {
          setHistory(null);
          conversation.startNew();
        }}
        size="icon"
        type="button"
        variant="ghost"
      >
        <SquarePenIcon />
      </Button>
      {history !== null ? (
        <div
          role="dialog"
          aria-label="历史对话"
          className="absolute top-full right-0 z-10 mt-2 w-72 rounded-xl border bg-popover p-2 text-sm text-popover-foreground shadow-lg backdrop-blur-2xl"
        >
          {history.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">还没有保存的对话。</p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
              {history.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:opacity-60"
                    aria-current={item.id === conversation.conversationId ? "true" : undefined}
                    disabled={opening !== null || item.id === conversation.conversationId}
                    onClick={() => void open(item.id)}
                  >
                    <span className="line-clamp-1 text-xs font-medium">
                      {item.title || "（未命名对话）"}
                      {item.id === conversation.conversationId ? " · 当前" : ""}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      <LocalizedDateTime dateTime={item.updatedAt} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {notice ? <p className="px-2 pt-1.5 text-xs text-destructive">{notice}</p> : null}
          <p className="px-2 pt-1.5 text-[11px] text-muted-foreground">只保留最近 30 段对话，只有你自己看得到。</p>
        </div>
      ) : null}
    </div>
  );
}
