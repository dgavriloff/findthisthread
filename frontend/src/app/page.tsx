"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ExternalLink, CheckCircle, XCircle, Clock, Activity, Wifi, WifiOff } from "lucide-react";

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
}

type ConnectionStatus = "connecting" | "connected" | "disconnected";

export default function Dashboard() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
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
            <CardTitle className="text-destructive">Connection Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={connect} className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">FindThisThread</h1>
            <p className="text-muted-foreground">Reddit Screenshot Bot Dashboard</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm">
              {connectionStatus === "connected" ? (
                <Badge variant="outline" className="text-green-500 border-green-500">
                  <Wifi className="mr-1 h-3 w-3" /> Live
                </Badge>
              ) : connectionStatus === "connecting" ? (
                <Badge variant="outline" className="text-yellow-500 border-yellow-500">
                  <RefreshCw className="mr-1 h-3 w-3 animate-spin" /> Connecting
                </Badge>
              ) : (
                <Badge variant="outline" className="text-red-500 border-red-500">
                  <WifiOff className="mr-1 h-3 w-3" /> Offline
                </Badge>
              )}
            </div>
            <Button onClick={triggerRefresh} disabled={refreshing || connectionStatus !== "connected"}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Check Now
            </Button>
          </div>
        </div>

        {/* Timer Bar */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground flex items-center">
                <Clock className="mr-2 h-4 w-4" />
                Next check in {formatTime(status?.timeUntilNextCheck || 0)}
              </span>
              <Badge variant={status?.isRunning ? "success" : "destructive"}>
                {status?.isRunning ? "Running" : "Stopped"}
              </Badge>
            </div>
            <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300 ease-linear"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total Processed</CardDescription>
              <CardTitle className="text-4xl">{status?.stats.total || 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Successful</CardDescription>
              <CardTitle className="text-4xl text-green-500">{status?.stats.successful || 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Failed</CardDescription>
              <CardTitle className="text-4xl text-red-500">{status?.stats.failed || 0}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Mentions Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Activity className="mr-2 h-5 w-5" />
              Recent Mentions
            </CardTitle>
            <CardDescription>Last 50 processed mentions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {mentions.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No mentions processed yet</p>
              ) : (
                mentions.map((mention) => (
                  <div
                    key={mention.mention_id}
                    className="flex items-start gap-4 p-4 rounded-lg border bg-card"
                  >
                    {mention.image_url && (
                      <a href={mention.image_url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                        <img
                          src={mention.image_url}
                          alt="Screenshot"
                          className="w-20 h-20 object-cover rounded-md border hover:opacity-80 transition-opacity"
                        />
                      </a>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">@{mention.author_username}</span>
                        {mention.reddit_url ? (
                          <Badge variant="success" className="flex items-center gap-1">
                            <CheckCircle className="h-3 w-3" /> Found
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="flex items-center gap-1">
                            <XCircle className="h-3 w-3" /> {mention.result}
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
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
                            Go to Reddit
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
    </div>
  );
}
