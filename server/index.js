// Express 应用：REST API + 前端静态托管 + 附件服务（PRD §8）
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { load, attachmentsDir, notesDir } from "./config.js";
import { listNotes, getNote, renameNote, deleteNote, parseNoteStructured } from "./notes.js";
import { editNote, saveImage } from "./writer.js";
import { runAgent, buildItemContext, buildPrompt, ADAPTERS } from "./agent.js";
import { loadChat, appendChat, clearChat } from "./chats.js";
import { analyzeImport, executeImport } from "./import.js";
import { getHeatmap } from "./stats.js";
import { getResonance } from "./social.js";
import { getSetupStatus, testKey, testVault, saveSetup } from "./setup.js";
import { syncAll } from "./sync.js";
import { listNotebooks } from "./weread.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfg = load();
const PORT = cfg.port || 5175;

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---- 首次运行向导 / 设置（开源版：每用户自己的 key 与库路径）----
app.get("/api/setup/status", async (req, res) => {
  try {
    res.json(await getSetupStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/setup/test-key", async (req, res) => {
  try {
    res.json(await testKey(req.body?.apiKey));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/setup/test-vault", (req, res) => {
  try {
    res.json(testVault(req.body?.vaultRoot));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/setup/save", async (req, res) => {
  try {
    res.json(await saveSetup(req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- 笔记库 ----
app.get("/api/notes", (req, res) => {
  try {
    res.json(listNotes());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/notes/:file", (req, res) => {
  try {
    res.json(getNote(req.params.file));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

app.put("/api/notes/:file/rename", (req, res) => {
  try {
    const newName = String(req.body?.name || "").trim();
    const file = renameNote(req.params.file, newName);
    res.json({ file });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 块级编辑（PRD F4）：ops 语义见 server/writer.js
app.post("/api/notes/:file/edit", (req, res) => {
  try {
    const ops = req.body?.ops;
    if (!Array.isArray(ops) || !ops.length) throw new Error("缺少操作列表");
    const r = editNote(req.params.file, ops);
    res.json(r);
  } catch (e) {
    res.status(e.message.includes("定位失败") ? 409 : 400).json({ error: e.message });
  }
});

// 图片上传：{name, data(base64)} → attachments/{笔记主名}_{时间戳}.{ext}
app.post("/api/notes/:file/images", (req, res) => {
  try {
    const { name, data } = req.body || {};
    const r = saveImage(req.params.file, name, data);
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/notes/:file", (req, res) => {
  try {
    if (req.body?.confirm !== true) throw new Error("缺少确认标记");
    const r = deleteNote(req.params.file);
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- 同段共鸣（P1-4）：热门划线归属 + 公开想法，只在 UI 展示不落盘 ----
app.get("/api/notes/:file/resonance", async (req, res) => {
  try {
    res.json(await getResonance(req.params.file, req.query.force === "1"));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- AI 对话（PRD F5）：claude -p，上下文=书/章/条目±相邻 ----
// 对话历史由服务端持久化（chats.js）：同一条目跨刷新/重开面板续接，上限 agent.historyRounds 轮
app.post("/api/agent/chat", async (req, res) => {
  try {
    const { file, itemKey, question, publicIdeas } = req.body || {};
    if (!file || !itemKey || !String(question || "").trim()) throw new Error("缺少 file / itemKey / question");
    const note = getNote(file);
    const ctx = buildItemContext(note, itemKey);
    const scope = note.meta?.bookId || path.basename(file, path.extname(file));
    const { messages: history } = loadChat(scope, itemKey);
    const rounds = (load().agent?.historyRounds || 20) * 2; // 一轮 = 一问一答
    const prompt = buildPrompt(ctx, String(question).trim(), history.slice(-rounds), Array.isArray(publicIdeas) ? publicIdeas : []);
    const answer = await runAgent(prompt);
    const stored = appendChat(scope, itemKey, String(question).trim(), answer); // 成功才追加，失败不留幽灵轮
    const cfg = load();
    res.json({ answer, agent: ADAPTERS[cfg.agent?.cli || "claude"].label, messages: stored.messages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 某条目的 AI 对话历史（打开面板时载入「接着上次」）
app.get("/api/notes/:file/chat-history", (req, res) => {
  try {
    const itemKey = String(req.query.itemKey || "");
    if (!itemKey) throw new Error("缺少 itemKey");
    const note = getNote(req.params.file);
    const scope = note.meta?.bookId || path.basename(req.params.file, path.extname(req.params.file));
    res.json(loadChat(scope, itemKey));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 清空该条目的对话（面板「清空重开」）
app.delete("/api/notes/:file/chat-history", (req, res) => {
  try {
    const itemKey = String(req.query.itemKey || "");
    if (!itemKey) throw new Error("缺少 itemKey");
    const note = getNote(req.params.file);
    const scope = note.meta?.bookId || path.basename(req.params.file, path.extname(req.params.file));
    clearChat(scope, itemKey);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- 旧笔记导入（PRD F7）----
app.post("/api/import/analyze", (req, res) => {
  try {
    const r = analyzeImport(req.body?.path);
    if (r.error) return res.status(400).json({ error: r.error });
    // ops 属内部细节，不回传给前端
    const { ops, imageFiles, ...report } = r;
    res.json({ ...report, imagesTotal: imageFiles.length, imagesMissing: report.images?.missing || [] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/import/execute", (req, res) => {
  try {
    res.json(executeImport(req.body?.path));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- 全库搜索（PRD F8）----
app.get("/api/search", (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const terms = q.split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());
    if (!terms.length) return res.json([]);
    const hit = (text) => {
      const low = String(text || "").toLowerCase();
      return terms.every((t) => low.includes(t));
    };
    const snippet = (text) => {
      const low = String(text).toLowerCase();
      let idx = -1;
      for (const t of terms) {
        const i = low.indexOf(t);
        if (i >= 0 && (idx === -1 || i < idx)) idx = i;
      }
      if (idx === -1) return String(text).slice(0, 64);
      const from = Math.max(0, idx - 30);
      return (from > 0 ? "…" : "") + String(text).slice(from, idx + terms[0].length + 34) + "…";
    };
    const results = [];
    for (const meta of listNotes()) {
      const detail = parseNoteStructured(fs.readFileSync(path.join(notesDir(), meta.file), "utf-8"));
      if (hit(meta.title) || hit(meta.author)) {
        results.push({ file: meta.file, book: meta.title, chapter: "", itemId: "", itemKey: "", heading: "", kind: "书名", snippet: `${meta.title} · ${meta.author}` });
      }
      for (const ch of detail.chapters) {
        for (const it of ch.items) {
          const targets = [
            [it.quote.join("\n"), "划线"],
            ...it.extras.map((e) => [e.kind === "idea" || e.kind === "thought" ? e.text : e.kind === "callout" ? `${e.title}\n${e.body}` : e.kind === "image" ? e.name : e.text, e.kind === "idea" ? "想法" : e.kind === "thought" ? "思考" : e.kind === "callout" ? "批注" : "内容"]),
          ];
          for (const [text, kind] of targets) {
            if (hit(text)) {
              results.push({
                file: meta.file,
                book: meta.title,
                chapter: ch.title,
                itemId: it.id,
                itemKey: it.key,
                heading: it.heading,
                kind,
                snippet: snippet(text),
              });
              break;
            }
          }
        }
      }
      if (results.length > 200) break;
    }
    res.json(results.slice(0, 100));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 阅读热力图 ----
app.get("/api/stats/heatmap", async (req, res) => {
  try {
    res.json(await getHeatmap(req.query.force === "1"));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 同步 ----
app.post("/api/sync", async (req, res) => {
  try {
    const report = await syncAll({ book: req.body?.book || undefined });
    res.json({ report });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 同步状态徽标：服务器侧计数 vs 本地计数（一次 API 调用）
app.get("/api/sync/status", async (req, res) => {
  try {
    const [server, local] = await Promise.all([listNotebooks(), Promise.resolve(listNotes())]);
    const byId = new Map(server.map((b) => [b.bookId, b]));
    const pending = {};
    for (const n of local) {
      if (!n.bookId) continue;
      const s = byId.get(n.bookId);
      if (!s) continue;
      const localTotal = n.counts.highlights + n.counts.ideas;
      const serverTotal = s.noteCount + s.reviewCount;
      if (serverTotal > localTotal) pending[n.file] = { serverTotal, localTotal };
    }
    res.json({ pending, checkedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 附件（图片）----
app.get("/api/attachments/:name", (req, res) => {
  const name = path.basename(decodeURIComponent(req.params.name));
  const p = path.resolve(attachmentsDir(), name);
  if (!p.startsWith(path.resolve(attachmentsDir()) + path.sep) || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
    return res.status(404).end();
  }
  res.sendFile(p);
});

// ---- 前端静态托管（生产模式）----
const dist = path.join(ROOT, "web", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`微信读书笔记工作台已启动: http://localhost:${PORT}`);
});
