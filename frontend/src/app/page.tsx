"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { RefreshCw, ExternalLink, Check, X, Clock, RotateCcw } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";

interface BotStatus {
  lastCheckTime: number;
  nextCheckTime: number;
  pollIntervalMs: number;
  isRunning: boolean;
  stats: { total: number; successful: number; failed: number };
  currentTime: number;
  timeUntilNextCheck: number;
}

interface Mention {
  mention_id: string;
  author_username: string;
  processed_at: string;
  result: string;
  reddit_url: string | null;
  extracted_subreddit: string | null;
  extracted_username: string | null;
  extracted_title: string | null;
  image_url: string | null;
  parent_author: string | null;
  mention_text: string | null;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected";

export default function Dashboard() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [modalImage, setModalImage] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setConnectionStatus("connecting");
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setConnectionStatus("connected");
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        switch (message.type) {
          case "init":
            setStatus(message.data.status);
            setMentions(message.data.mentions);
            setLoading(false);
            break;
          case "tick":
            setStatus((prev) =>
              prev ? { ...prev, ...message.data } : prev
            );
            break;
          case "status":
            setStatus(message.data);
            break;
          case "mentions":
            setMentions(message.data);
            break;
          case "refresh_ack":
            setRefreshing(false);
            break;
          case "reprocess_result":
            alert(message.data.message);
            break;
        }
      } catch (err) {
        console.error("WebSocket parse error:", err);
      }
    };

    ws.onclose = () => {
      setConnectionStatus("disconnected");
      wsRef.current = null;
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const triggerRefresh = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setRefreshing(true);
      wsRef.current.send(JSON.stringify({ type: "refresh" }));
    }
  };

  const reprocessMention = (mentionId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "reprocess", mentionId }));
    }
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  const progressPercent = status
    ? Math.max(0, Math.min(100, ((status.pollIntervalMs - status.timeUntilNextCheck) / status.pollIntervalMs) * 100))
    : 0;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm">connecting...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-4 py-3 max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">findthisthread</h1>
              <p className="text-xs text-muted-foreground">reddit link finder</p>
            </div>
            <button
              onClick={triggerRefresh}
              disabled={refreshing || connectionStatus !== "connected"}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-secondary hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
              check now
            </button>
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="h-1 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#FF4500] rounded-full transition-all duration-300 ease-linear"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono-data whitespace-nowrap flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTime(status?.timeUntilNextCheck || 0)}
            </span>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="px-4 py-4 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            link requests
          </h2>
          <span className="text-[10px] text-muted-foreground font-mono-data">
            {mentions.length} requests
          </span>
        </div>

        {mentions.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            no link requests yet
          </div>
        ) : (
          <div className="space-y-2">
            {mentions.map((mention) => (
              <article
                key={mention.mention_id}
                className="flex gap-3 p-3 rounded-md border border-border bg-card hover:border-border/80 transition-colors"
              >
                {/* Thumbnail */}
                {mention.image_url && (
                  <button
                    onClick={() => setModalImage(mention.image_url)}
                    className="flex-shrink-0 group"
                  >
                    <img
                      src={mention.image_url}
                      alt=""
                      className="w-14 h-14 sm:w-16 sm:h-16 object-cover rounded border border-border group-hover:opacity-80 transition-opacity"
                    />
                  </button>
                )}

                {/* Content */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    {/* Status + metadata row */}
                    <div className="flex items-center gap-2 mb-1">
                      {mention.reddit_url ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-600 dark:text-green-500">
                          <Check className="h-3 w-3" />
                          found
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-500">
                          <X className="h-3 w-3" />
                          {mention.result.toLowerCase()}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(mention.processed_at)}
                      </span>
                    </div>

                    {/* Users */}
                    <div className="text-xs space-y-0.5">
                      {mention.parent_author && mention.parent_author !== "unknown" && (
                        <div className="truncate">
                          <span className="text-muted-foreground">posted by </span>
                          <span className="font-medium">@{mention.parent_author}</span>
                        </div>
                      )}
                      {mention.author_username && mention.author_username !== "unknown" && (
                        <div className="truncate">
                          <span className="text-muted-foreground">requested by </span>
                          <span className="font-medium">@{mention.author_username}</span>
                        </div>
                      )}
                    </div>

                    {/* Extracted info */}
                    {(mention.extracted_subreddit || mention.extracted_username) && (
                      <div className="text-[10px] text-muted-foreground mt-1 truncate font-mono-data">
                        {mention.extracted_subreddit && <span>r/{mention.extracted_subreddit} </span>}
                        {mention.extracted_username && <span>u/{mention.extracted_username}</span>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Action */}
                <div className="flex-shrink-0 flex items-center">
                  {mention.reddit_url ? (
                    <a
                      href={mention.reddit_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#FF4500] hover:bg-[#E03D00] text-white transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      reddit
                    </a>
                  ) : (
                    <button
                      onClick={() => reprocessMention(mention.mention_id)}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border hover:bg-secondary transition-colors"
                      title="retry"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {/* Image modal */}
      {modalImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setModalImage(null)}
        >
          <div className="relative max-w-3xl w-full">
            <img
              src={modalImage}
              alt=""
              className="w-full max-h-[85vh] object-contain rounded-md"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setModalImage(null)}
              className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-white text-black flex items-center justify-center text-sm font-medium hover:bg-gray-100 transition-colors"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
