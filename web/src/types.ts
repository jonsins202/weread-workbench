export interface NoteCounts {
  chapters: number;
  highlights: number;
  ideas: number;
  thoughts: number;
  callouts: number;
  images: number;
}

export interface NoteMeta {
  file: string;
  bookId: string | null;
  title: string;
  displayTitle: string;
  author: string;
  cover: string;
  status: string;
  progress: number;
  syncedAt: string;
  createdAt: string;
  manual: boolean;
  counts: NoteCounts;
  mtime: string;
}

export type Segment =
  | { kind: "idea"; text: string; raw: string }
  | { kind: "thought"; text: string; raw: string }
  | { kind: "callout"; type: string; title: string; body: string; raw: string }
  | { kind: "image"; name: string; raw: string }
  | { kind: "link"; text: string; url: string; raw: string }
  | { kind: "text"; text: string; raw: string };

export interface NoteItem {
  id: string;
  key: string;
  type: "highlight" | "idea";
  heading: string;
  quote: string[];
  extras: Segment[];
}

export interface NoteChapter {
  id: string;
  num: string;
  title: string;
  metaLine: string;
  jumpUrl: string;
  stats: string;
  items: NoteItem[];
}

export interface NoteDetail {
  file: string;
  meta: Record<string, string>;
  bookTitle: string;
  headerMeta: string;
  chapters: NoteChapter[];
  orphans: Segment[];
  counts: NoteCounts;
}

export interface ResonanceIdea {
  author: string;
  content: string;
  date: string;
}

export interface ResonanceData {
  fetchedAt: string;
  matched: Record<string, { count: number; ideas: ResonanceIdea[] }>;
  others: { count: number; text: string; ideas: ResonanceIdea[] }[];
}
