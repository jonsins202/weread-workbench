import type { NoteMeta, NoteDetail, ResonanceData } from "./types";

export interface ImportReport {
  targetTitle: string;
  targetFile: string;
  matched: { heading: string; quote: string; segments: number }[];
  unmatched: { heading: string; quote: string; toOrphan: boolean }[];
  essays: string[];
  imagesTotal: number;
  imagesMissing: string[];
  inserted: number;
  skippedDup: number;
}

export interface SearchHit {
  file: string;
  book: string;
  chapter: string;
  itemId: string;
  itemKey: string;
  heading: string;
  kind: string;
  snippet: string;
}

export interface HeatmapData {
  days: { date: string; seconds: number }[];
  totalSeconds: number;
  readDays: number;
  longestSeconds: number;
  avgSeconds: number;
  range: { from: string; to: string };
}

const j = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data;
};

export const api = {
  listNotes: () => j("/api/notes") as Promise<NoteMeta[]>,
  getNote: (file: string) => j(`/api/notes/${encodeURIComponent(file)}`) as Promise<NoteDetail>,
  rename: (file: string, name: string) =>
    j(`/api/notes/${encodeURIComponent(file)}/rename`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
  remove: (file: string) =>
    j(`/api/notes/${encodeURIComponent(file)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    }),
  sync: (book?: string) =>
    j("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(book ? { book } : {}),
    }),
  edit: (file: string, ops: unknown[]) =>
    j(`/api/notes/${encodeURIComponent(file)}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops }),
    }),
  uploadImage: (file: string, name: string, data: string) =>
    j(`/api/notes/${encodeURIComponent(file)}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, data }),
    }),
  chat: (file: string, itemKey: string, question: string, publicIdeas: string[] = []) =>
    j("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file, itemKey, question, publicIdeas }),
    }) as Promise<{ answer: string; agent: string; messages: { role: "user" | "ai"; content: string }[] }>,
  chatHistory: (file: string, itemKey: string) =>
    j(`/api/notes/${encodeURIComponent(file)}/chat-history?itemKey=${encodeURIComponent(itemKey)}`) as Promise<{
      messages: { role: "user" | "ai"; content: string }[];
      updatedAt: string | null;
    }>,
  clearChat: (file: string, itemKey: string) =>
    j(`/api/notes/${encodeURIComponent(file)}/chat-history?itemKey=${encodeURIComponent(itemKey)}`, {
      method: "DELETE",
    }) as Promise<{ ok: boolean }>,

  importAnalyze: (p: string) =>
    j("/api/import/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p }),
    }) as Promise<ImportReport>,
  importExecute: (p: string) =>
    j("/api/import/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p }),
    }) as Promise<{ message: string; changed: boolean }>,
  search: (q: string) => j(`/api/search?q=${encodeURIComponent(q)}`) as Promise<SearchHit[]>,
  heatmap: () => j("/api/stats/heatmap") as Promise<HeatmapData>,
  resonance: (file: string) => j(`/api/notes/${encodeURIComponent(file)}/resonance`) as Promise<ResonanceData>,
  syncStatus: () => j("/api/sync/status") as Promise<{ pending: Record<string, { serverTotal: number; localTotal: number }> }>,
};
