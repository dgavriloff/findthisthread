"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ExternalLink, CheckCircle, XCircle, Clock } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
// Convert http(s) to ws(s) for WebSocket URL
const WS_URL = API_URL.replace(/^http/, "ws") + "/ws";

interface BotStatus {
  lastCheckTime: number;
  nextCheckTime: number;
  pollIntervalMs: number;
  isRunning: boolean;
  stats: {
    total: number;
    successful: number;
    failed: number;
  };
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
  const [error, setError] = useState<string | null>(null);
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
      console.log("WebSocket connected");
      setConnectionStatus("connected");
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case "init":
            // Initial data on connect
            setStatus(message.data.status);
            setMentions(message.data.mentions);
            setLoading(false);
            break;
          case "tick":
            // Timer update every second
            setStatus((prev) =>
              prev
                ? {
                    ...prev,
                    currentTime: message.data.currentTime,
                    timeUntilNextCheck: message.data.timeUntilNextCheck,
                    lastCheckTime: message.data.lastCheckTime,
                    nextCheckTime: message.data.nextCheckTime,
                  }
                : prev
            );
            break;
          case "status":
            // Full status update
            setStatus(message.data);
            break;
          case "mentions":
            // Mentions list update
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
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    ws.onclose = () => {
      console.log("WebSocket disconnected");
      setConnectionStatus("disconnected");
      wsRef.current = null;

      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log("Attempting to reconnect...");
        connect();
      }, 3000);
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
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
    return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error && connectionStatus === "disconnected") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">connection error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={connect} className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" /> retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const progressPercent = status
    ? Math.max(0, Math.min(100, ((status.pollIntervalMs - status.timeUntilNextCheck) / status.pollIntervalMs) * 100))
    : 0;

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold">findthisthread</h1>
          <p className="text-muted-foreground">reddit screenshot bot dashboard</p>
        </div>

        {/* Timer Bar */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                checking for link requests in {formatTime(status?.timeUntilNextCheck || 0)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-secondary rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300 ease-linear"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <Button size="sm" onClick={triggerRefresh} disabled={refreshing || connectionStatus !== "connected"}>
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                check now
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Link Requests */}
        <Card>
          <CardHeader>
            <CardTitle>link requests</CardTitle>
            <CardDescription>last 50 processed requests</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {mentions.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">no link requests yet</p>
              ) : (
                mentions.map((mention) => (
                  <div
                    key={mention.mention_id}
                    className="flex items-start gap-4 p-4 rounded-lg border bg-card"
                  >
                    {mention.image_url && (
                      <button onClick={() => setModalImage(mention.image_url)} className="flex-shrink-0">
                        <img
                          src={mention.image_url}
                          alt="Screenshot"
                          className="w-20 h-20 object-cover rounded-md border hover:opacity-80 transition-opacity cursor-pointer"
                        />
                      </button>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {mention.reddit_url ? (
                          <Badge variant="success" className="flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" /> found
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="flex items-center gap-1">
                            <XCircle className="h-3 w-3" /> {mention.result.toLowerCase()}
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm space-y-0.5">
                        {mention.parent_author && (
                          <div><span className="text-muted-foreground">screenshot posted by:</span> <span className="font-medium">@{mention.parent_author}</span></div>
                        )}
                        <div><span className="text-muted-foreground">link requested by:</span> <span className="font-medium">@{mention.author_username}</span></div>
                        {mention.mention_text && (() => {
                          const tagText = mention.mention_text.replace(/@\w+/g, '').trim();
                          return tagText ? (
                            <div><span className="text-muted-foreground">tag:</span> <span className="italic">"{tagText}"</span></div>
                          ) : null;
                        })()}
                      </div>
                      <div className="text-sm text-muted-foreground truncate mt-1">
                        {mention.extracted_subreddit && <span>r/{mention.extracted_subreddit} </span>}
                        {mention.extracted_username && <span>u/{mention.extracted_username} </span>}
                        {mention.extracted_title && (
                          <span className="italic">"{mention.extracted_title.substring(0, 50)}..."</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{formatDate(mention.processed_at)}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {mention.reddit_url ? (
                        <a href={mention.reddit_url} target="_blank" rel="noopener noreferrer">
                          <Button size="sm" className="bg-[#FF4500] hover:bg-[#FF5722] text-white">
                            <ExternalLink className="mr-1 h-4 w-4" />
                            go to reddit
                          </Button>
                        </a>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => reprocessMention(mention.mention_id)}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Image Modal */}
      {modalImage && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setModalImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            <img
              src={modalImage}
              alt="Screenshot"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setModalImage(null)}
              className="absolute -top-3 -right-3 bg-white text-black rounded-full w-8 h-8 flex items-center justify-center hover:bg-gray-200 font-bold"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
