"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { RefreshCw, ExternalLink, Check, X, RotateCcw, Trash2, Upload } from "lucide-react";

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
  parent_tweet_id: string | null;
  mention_text: string | null;
  is_complete: number; // 0 = can retry, 1 = final result
}

type ConnectionStatus = "connecting" | "connected" | "disconnected";

export default function Dashboard() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
          case "refresh_complete":
            setRefreshing(false);
            if (message.data.found === 0) {
              setToast("no new requests found");
              setTimeout(() => setToast(null), 3000);
            }
            break;
          case "reprocess_result":
            setReprocessingId(null);
            if (!message.data.success) {
              setToast(message.data.message || "still not found");
              setTimeout(() => setToast(null), 3000);
            }
            break;
          case "delete_result":
            if (message.data.success) {
              setToast("request deleted");
              setTimeout(() => setToast(null), 3000);
            }
            break;
          case "upload_result":
            setUploading(false);
            if (message.data.success) {
              setToast("found reddit link!");
            } else {
              setToast(message.data.message || "not found");
            }
            setTimeout(() => setToast(null), 3000);
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
      setReprocessingId(mentionId);
      wsRef.current.send(JSON.stringify({ type: "reprocess", mentionId }));
    }
  };

  const deleteMention = (mentionId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "delete", mentionId }));
      setDeleteConfirmId(null);
    }
  };

  const handleFileUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      setToast("please upload an image file");
      setTimeout(() => setToast(null), 3000);
      return;
    }

    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      setToast("not connected");
      setTimeout(() => setToast(null), 3000);
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      wsRef.current?.send(JSON.stringify({ type: "upload", imageData: base64 }));
    };
    reader.onerror = () => {
      setUploading(false);
      setToast("failed to read file");
      setTimeout(() => setToast(null), 3000);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

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
          <div className="flex items-center justify-between">
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
              check for requests
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="px-4 py-4 max-w-2xl mx-auto">
        {/* Upload area */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !uploading && fileInputRef.current?.click()}
          className={`mb-4 border-2 border-dashed rounded-md p-3 flex items-center justify-center gap-2 cursor-pointer transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
              : uploading
              ? "border-amber-500/50 bg-amber-500/5"
              : "border-border hover:border-muted-foreground/50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
              e.target.value = "";
            }}
          />
          {uploading ? (
            <>
              <RefreshCw className="h-4 w-4 text-amber-500 animate-spin" />
              <span className="text-xs text-amber-500">searching reddit...</span>
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                drop screenshot or click to upload
              </span>
            </>
          )}
        </div>

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
                      ) : mention.result === "processing" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-500">
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          found request by @{mention.author_username}, processing...
                        </span>
                      ) : mention.result === "rate_limited" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-500">
                          <RotateCcw className="h-3 w-3" />
                          reddit says try later
                        </span>
                      ) : mention.result === "api_error" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-500">
                          <RotateCcw className="h-3 w-3" />
                          reddit error - try later
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-500">
                          <X className="h-3 w-3" />
                          {mention.result === "user_not_found" ? "user deleted" : mention.result.toLowerCase()}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {formatDate(mention.processed_at)}
                      </span>
                    </div>

                    {/* Users */}
                    <div className="text-xs space-y-0.5">
                      {mention.parent_author && mention.parent_author !== "unknown" && mention.parent_tweet_id && (
                        <div className="truncate">
                          <span className="text-muted-foreground">posted by </span>
                          <a
                            href={`https://x.com/${mention.parent_author}/status/${mention.parent_tweet_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:underline"
                          >
                            @{mention.parent_author}
                          </a>
                        </div>
                      )}
                      {mention.author_username && mention.author_username !== "unknown" && (
                        <div className="truncate">
                          <span className="text-muted-foreground">requested by </span>
                          <a
                            href={`https://x.com/${mention.author_username}/status/${mention.mention_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:underline"
                          >
                            @{mention.author_username}
                          </a>
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
                <div className="flex-shrink-0 flex flex-col items-end gap-1">
                  {mention.reddit_url ? (
                    <>
                      <a
                        href={mention.reddit_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#FF4500] hover:bg-[#E03D00] text-white transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                        reddit
                      </a>
                      {reprocessingId === mention.mention_id ? (
                        <span className="text-[10px] text-amber-500 flex items-center gap-1">
                          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                          searching...
                        </span>
                      ) : (
                        <button
                          onClick={() => reprocessMention(mention.mention_id)}
                          disabled={reprocessingId !== null}
                          className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          find again
                        </button>
                      )}
                    </>
                  ) : mention.result === "processing" || reprocessingId === mention.mention_id ? (
                    <div className="w-8 h-8 flex items-center justify-center">
                      <RefreshCw className="h-3.5 w-3.5 text-amber-500 animate-spin" />
                    </div>
                  ) : !mention.is_complete ? (
                    <>
                      <button
                        onClick={() => reprocessMention(mention.mention_id)}
                        disabled={reprocessingId !== null}
                        className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title="retry"
                      >
                        <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      {(mention.result === "no_parent" || mention.result === "no_media") && (
                        <button
                          onClick={() => setDeleteConfirmId(mention.mention_id)}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-red-500/30 hover:bg-red-500/10 transition-colors"
                          title="delete"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </button>
                      )}
                    </>
                  ) : (mention.result === "no_parent" || mention.result === "no_media") ? (
                    <button
                      onClick={() => setDeleteConfirmId(mention.mention_id)}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-red-500/30 hover:bg-red-500/10 transition-colors"
                      title="delete"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </button>
                  ) : null}
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

      {/* Delete confirmation modal */}
      {deleteConfirmId && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setDeleteConfirmId(null)}
        >
          <div
            className="bg-card border border-border rounded-md p-4 max-w-xs w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm mb-4">delete this request?</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-secondary transition-colors"
              >
                no
              </button>
              <button
                onClick={() => deleteMention(deleteConfirmId)}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                yes, delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-card border border-border rounded-md shadow-lg text-xs text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toast}
        </div>
      )}
    </div>
  );
}
