import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { ImportReport, SearchHit, HeatmapData } from "../api";
import type { NoteMeta } from "../types";

/** ---- 阅读热力图（滚动一年，GitHub 风格）---- */
function HeatmapCard() {
  const [data, setData] = useState<HeatmapData | null>(null);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    api.heatmap().then(setData).catch((e) => setError((e as Error).message));
  }, []);

  const grid = useMemo(() => {
    if (!data) return null;
    const secMap = new Map(data.days.map((d) => [d.date, d.seconds]));
    const today = new Date();
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    // 从今天回退到 52 周前的周一
    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // 对齐周一
    const weeks: { cells: { date: string; seconds: number; future: boolean; label: string }[]; monthLabel: string }[] = [];
    const cursor = new Date(start);
    let lastMonth = -1;
    for (let w = 0; w < 53; w++) {
      const cells: { date: string; seconds: number; future: boolean; label: string }[] = [];
      let monthLabel = "";
      for (let d = 0; d < 7; d++) {
        const date = fmt(cursor);
        const day = cursor.getDate();
        if (d === 0 || day <= 7) {
          if (cursor.getMonth() !== lastMonth) {
            lastMonth = cursor.getMonth();
            monthLabel = `${cursor.getMonth() + 1}月`;
          }
        }
        cells.push({
          date,
          seconds: secMap.get(date) || 0,
          future: cursor > today,
          label: `${cursor.getMonth() + 1}月${cursor.getDate()}日`,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push({ cells, monthLabel });
    }
    return weeks;
  }, [data]);

  const level = (s: number) => (s === 0 ? 0 : s < 1200 ? 1 : s < 3000 ? 2 : s < 6000 ? 3 : 4); // 20/50/100 分钟分档
  const fmtH = (s: number) => (s / 3600).toFixed(1);
  const fmtM = (s: number) => Math.round(s / 60);

  return (
    <div className="heatmap-card">
      <div className="heatmap-head">
        <h3>📈 阅读热力图</h3>
        {data && (
          <span className="heatmap-summary">
            近一年 {fmtH(data.totalSeconds)} 小时 · {data.readDays} 天有阅读 · 单日最长 {fmtM(data.longestSeconds)} 分钟 · 活跃日均 {fmtM(data.avgSeconds)} 分钟
          </span>
        )}
        <button className="btn tiny" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? "展开" : "收起"}
        </button>
      </div>
      {!collapsed && (
        <div className="heatmap-body">
          {error && <div className="ai-error">热力图数据获取失败：{error}</div>}
          {!error && !grid && <div className="heatmap-loading">加载中（首次需拉取 12 个月数据，约几秒）…</div>}
          {grid && (
            <div className="heatmap-scroll">
              <div className="heatmap-grid">
                {grid.map((w, i) => (
                  <div className="heatmap-week" key={i}>
                    <div className="heatmap-month-label">{w.monthLabel}</div>
                    {w.cells.map((c) => (
                      <div
                        key={c.date}
                        className={`heatmap-cell lv${level(c.seconds)}${c.future ? " future" : ""}`}
                        title={`${c.label}${c.seconds ? ` · ${fmtM(c.seconds)} 分钟` : ""}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="heatmap-legend">
                少
                {[0, 1, 2, 3, 4].map((l) => (
                  <div key={l} className={`heatmap-cell lv${l}`} />
                ))}
                多（分钟）
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type SortKey = "synced" | "progress" | "highlights" | "title";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "synced", label: "最近同步" },
  { key: "progress", label: "阅读进度" },
  { key: "highlights", label: "划线数量" },
  { key: "title", label: "书名" },
];

function Cover({ note }: { note: NoteMeta }) {
  const [err, setErr] = useState(false);
  if (!note.cover || err) {
    return (
      <div className="cover fallback">
        <span>{note.title.slice(0, 2)}</span>
      </div>
    );
  }
  return <img className="cover" src={note.cover} alt="" loading="lazy" onError={() => setErr(true)} />;
}

export default function Shelf({ onOpen }: { onOpen: (file: string, anchor?: string) => void }) {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [pending, setPending] = useState<Record<string, { serverTotal: number; localTotal: number }>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("synced");
  const [renaming, setRenaming] = useState<NoteMeta | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [deleting, setDeleting] = useState<NoteMeta | null>(null);

  // 全局搜索（F8）：null=未搜索模式，数组=展示结果
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);

  // 旧笔记导入（F7）
  const [importOpen, setImportOpen] = useState(false);
  const [importPath, setImportPath] = useState("微信读书读书笔记_财经杂志/");
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");

  const reload = async () => {
    setLoading(true);
    try {
      setNotes(await api.listNotes());
      api.syncStatus().then((s) => setPending(s.pending)).catch(() => {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const doSync = async (book?: string) => {
    setSyncing(true);
    setMessage(book ? "同步中…" : "全量同步中，约需半分钟…");
    try {
      const { report } = await api.sync(book);
      const changed = report.filter((l: string) => l.startsWith("[更新]") || l.startsWith("[新建]"));
      setMessage(`同步完成：${changed.length} 本更新${changed.length ? "（" + changed.map((l: string) => l.split("] ")[1]?.split(" ->")[0]).join("、") + "）" : ""}`);
      await reload();
    } catch (e) {
      setMessage(`同步失败：${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const doRename = async () => {
    if (!renaming || !renameVal.trim()) return;
    try {
      const { file } = await api.rename(renaming.file, renameVal.trim());
      setRenaming(null);
      await reload();
      setMessage(`已重命名为 ${file}`);
    } catch (e) {
      setMessage(`重命名失败：${(e as Error).message}`);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      const r = await api.remove(deleting.file);
      setDeleting(null);
      await reload();
      setMessage(`已删除${r.removedImages ? `（连带 ${r.removedImages} 张图片）` : ""}`);
    } catch (e) {
      setMessage(`删除失败：${(e as Error).message}`);
    }
  };

  const list = useMemo(() => {
    let arr = notes;
    if (search.trim() && !hits) {
      const q = search.trim().toLowerCase();
      arr = arr.filter((n) => n.title.toLowerCase().includes(q) || n.author.toLowerCase().includes(q));
    }
    const by: Record<SortKey, (a: NoteMeta, b: NoteMeta) => number> = {
      synced: (a, b) => (b.syncedAt || "").localeCompare(a.syncedAt || ""),
      progress: (a, b) => b.progress - a.progress,
      highlights: (a, b) => b.counts.highlights - a.counts.highlights,
      title: (a, b) => a.title.localeCompare(b.title, "zh"),
    };
    return [...arr].sort(by[sort]);
  }, [notes, search, sort, hits]);

  const runSearch = async () => {
    const q = search.trim();
    if (!q) {
      setHits(null);
      return;
    }
    setSearchBusy(true);
    try {
      setHits(await api.search(q));
    } catch (e) {
      setMessage(`搜索失败：${(e as Error).message}`);
    } finally {
      setSearchBusy(false);
    }
  };

  const doImportAnalyze = async () => {
    setImportBusy(true);
    setImportError("");
    setImportReport(null);
    try {
      const r = await api.importAnalyze(importPath.trim());
      setImportReport(r);
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  };

  const doImportExecute = async () => {
    setImportBusy(true);
    setImportError("");
    try {
      const r = await api.importExecute(importPath.trim());
      setImportOpen(false);
      setImportReport(null);
      await reload();
      setMessage(r.message);
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="shelf-header">
        <div>
          <h1>微信读书笔记</h1>
          <p className="sub">{notes.length} 本 · Obsidian 库的另一个窗口</p>
        </div>
        <div className="shelf-actions">
          <input
            className="input search"
            placeholder="搜书名/划线/想法/批注…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (!e.target.value.trim()) setHits(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
              if (e.key === "Escape") {
                setSearch("");
                setHits(null);
              }
            }}
          />
          <button className="btn" disabled={searchBusy || !search.trim()} onClick={runSearch}>
            {searchBusy ? "搜索中…" : "搜索"}
          </button>
          {hits && (
            <button className="btn" onClick={() => { setSearch(""); setHits(null); }}>
              ✕ 结果
            </button>
          )}
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                按{s.label}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => { setImportOpen(true); setImportReport(null); setImportError(""); }}>
            导入旧笔记
          </button>
          <button className="btn primary" disabled={syncing} onClick={() => doSync()}>
            {syncing ? "同步中…" : "全量同步"}
          </button>
        </div>
      </header>

      {message && (
        <div className="message-bar" onClick={() => setMessage("")}>
          {message} <span className="dismiss">✕</span>
        </div>
      )}

      {!hits && <HeatmapCard />}

      {hits ? (
        <div className="search-results">
          <div className="search-summary">
            {searchBusy ? "搜索中…" : `全库搜索「${search}」：${hits.length} 条结果${hits.length >= 100 ? "（已达上限）" : ""}`}
          </div>
          {hits.length === 0 && <div className="empty">没有命中内容</div>}
          {hits.map((h, i) => (
            <button
              key={i}
              className="search-hit"
              onClick={() => onOpen(h.file, h.itemId || undefined)}
            >
              <div className="hit-meta">
                <span className="chip plain">{h.kind}</span>
                <span className="hit-book">{h.book}</span>
                {h.chapter && <span className="hit-chapter">{h.chapter}</span>}
                {h.heading && <span className="hit-heading">{h.heading}</span>}
              </div>
              <div className="hit-snippet">{h.snippet}</div>
            </button>
          ))}
        </div>
      ) : loading ? (
        <div className="empty">加载中…</div>
      ) : list.length === 0 ? (
        <div className="empty">没有匹配的笔记</div>
      ) : (
        <div className="card-grid">
          {list.map((n) => (
            <div key={n.file} className="book-card" onClick={() => onOpen(n.file)}>
              <Cover note={n} />
              <div className="book-info">
                <div className="book-title-row">
                  <span className="book-title" title={n.displayTitle}>{n.title}</span>
                  {n.manual && <span className="chip gray">手动</span>}
                  {pending[n.file] && <span className="chip orange" title={`服务器 ${pending[n.file].serverTotal} 条 / 本地 ${pending[n.file].localTotal} 条`}>有更新</span>}
                </div>
                <div className="book-meta">
                  <span className={`chip ${n.status === "读完" ? "green" : "blue"}`}>{n.status || "—"}</span>
                  <span className="counts">
                    {n.counts.highlights} 划线 · {n.counts.ideas + n.counts.thoughts} 想法
                  </span>
                </div>
                <div className="progress-row">
                  <div className="progress-bg">
                    <div className="progress-fill" style={{ width: `${n.progress}%` }} />
                  </div>
                  <span className="progress-num">{n.progress}%</span>
                </div>
                <div className="book-footer">
                  <span className="synced">同步于 {n.syncedAt || "—"}</span>
                  <span
                    className="card-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {n.bookId && pending[n.file] && (
                      <button className="icon-btn" title="同步此书" onClick={() => doSync(n.bookId!)}>
                        ⟳
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      title="重命名"
                      onClick={() => {
                        setRenaming(n);
                        setRenameVal(n.file.replace(/_读书笔记\.md$/, ""));
                      }}
                    >
                      ✎
                    </button>
                    <button className="icon-btn danger" title="删除" onClick={() => setDeleting(n)}>
                      🗑
                    </button>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {renaming && (
        <div className="modal-mask" onClick={() => setRenaming(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>重命名笔记</h3>
            <p className="sub">只改文件名，不影响内容与同步（bookId 不变）</p>
            <input
              className="input full"
              value={renameVal}
              autoFocus
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doRename()}
            />
            <div className="modal-actions">
              <button className="btn" onClick={() => setRenaming(null)}>
                取消
              </button>
              <button className="btn primary" onClick={doRename}>
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="modal-mask" onClick={() => setImportOpen(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>导入旧笔记</h3>
            <p className="sub">vault 内的旧笔记路径（相对或绝对）。只读导入、原文件不动；图片复制进 attachments；重复导入自动去重。</p>
            <div className="callout-form-row" style={{ marginTop: 10 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="如：微信读书读书笔记_财经杂志/财经2026第11期_读书笔记.md"
                value={importPath}
                onChange={(e) => setImportPath(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doImportAnalyze()}
              />
              <button className="btn" disabled={importBusy} onClick={doImportAnalyze}>
                {importBusy ? "分析中…" : "分析"}
              </button>
            </div>
            {importError && <div className="ai-error" style={{ marginTop: 10 }}>{importError}</div>}
            {importReport && (
              <div className="import-report">
                <p>
                  目标笔记：<b>《{importReport.targetTitle}》</b>
                </p>
                <p>
                  将新挂 <b>{importReport.inserted}</b> 段 ｜ 匹配划线 {importReport.matched.length} 条 ｜ 转入「仅想法」
                  {importReport.unmatched.length} 条 ｜ 随笔整节 {importReport.essays.length} 节 ｜ 重复跳过{" "}
                  {importReport.skippedDup} 段 ｜ 图片 {importReport.imagesTotal} 张
                  {importReport.imagesMissing.length > 0 && (
                    <span className="danger-text">（缺 {importReport.imagesMissing.length} 张：{importReport.imagesMissing.join("、")}）</span>
                  )}
                </p>
                {importReport.matched.length > 0 && (
                  <details>
                    <summary>匹配明细（{importReport.matched.length}）</summary>
                    <ul>
                      {importReport.matched.map((m, i) => (
                        <li key={i}>{m.heading}「{m.quote}…」→ 挂载 {m.segments} 段</li>
                      ))}
                    </ul>
                  </details>
                )}
                {importReport.unmatched.length > 0 && (
                  <details>
                    <summary>无法匹配（{importReport.unmatched.length}，将带原文进「仅想法」）</summary>
                    <ul>
                      {importReport.unmatched.map((m, i) => (
                        <li key={i}>{m.heading}「{m.quote}…」</li>
                      ))}
                    </ul>
                  </details>
                )}
                {importReport.essays.length > 0 && (
                  <details>
                    <summary>随笔小节（{importReport.essays.length}，标题转粗体进「仅想法」）</summary>
                    <ul>
                      {importReport.essays.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setImportOpen(false)}>
                取消
              </button>
              <button className="btn primary" disabled={importBusy || !importReport || importReport.inserted === 0} onClick={doImportExecute}>
                确认导入
              </button>
            </div>
          </div>
        </div>
      )}

      {deleting && (
        <div className="modal-mask" onClick={() => setDeleting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>删除笔记</h3>
            <p>
              将永久删除 <b>{deleting.file}</b>
              ，并连带删除 attachments 中归属它的图片。此操作不可撤销（可用 git 恢复）。
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDeleting(null)}>
                取消
              </button>
              <button className="btn danger" onClick={doDelete}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
