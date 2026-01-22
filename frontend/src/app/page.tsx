"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ExternalLink, CheckCircle, XCircle, Clock, Activity } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

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

export default function Dashboard() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, mentionsRes] = await Promise.all([
        fetch(`${API_URL}/api/status`),
        fetch(`${API_URL}/api/mentions?limit=50`),
      ]);

      if (!statusRes.ok || !mentionsRes.ok) {
        throw new Error("Failed to fetch data");
      }

      const statusData = await statusRes.json();
      const mentionsData = await mentionsRes.json();

      setStatus(statusData);
      setMentions(mentionsData.mentions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to API");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const triggerRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`${API_URL}/api/refresh`, { method: "POST" });
      await fetchData();
    } finally {
      setRefreshing(false);
    }
  };

  const reprocessMention = async (mentionId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/reprocess/${mentionId}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        await fetchData();
      }
      alert(data.message);
    } catch (err) {
      alert("Failed to reprocess");
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

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">Connection Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={fetchData} className="w-full">
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
          <Button onClick={triggerRefresh} disabled={refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Check Now
          </Button>
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
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-1000"
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
                    className="flex items-center justify-between p-4 rounded-lg border bg-card"
                  >
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
                    <div className="flex items-center gap-2 ml-4">
                      {mention.reddit_url ? (
                        <a href={mention.reddit_url} target="_blank" rel="noopener noreferrer">
                          <Button variant="outline" size="sm">
                            <ExternalLink className="h-4 w-4" />
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
