import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { NoteDetail, NoteChapter, NoteItem, Segment, ResonanceData, ResonanceIdea } from "../types";

const ORPHAN_KEY = "__orphans__";

const imgSrc = (name: string) =>
  name.startsWith("http") ? name : `/api/attachments/${encodeURIComponent(name)}`;

function renderInline(text: string) {
  const parts: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<b key={k++}>{m[2]}</b>);
    else if (m[4]) parts.push(<a key={k++} href={m[5]}>{m[4]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

interface EditCtx {
  itemKey: string;
  index: number;
  kind: Segment["kind"];
  type?: string;
  title?: string;
  text: string;
}

function SegmentView({
  seg,
  itemKey,
  index,
  onEdit,
  onDelete,
}: {
  seg: Segment;
  itemKey: string;
  index: number;
  onEdit: (seg: Segment, itemKey: string, index: number) => void;
  onDelete: (seg: Segment, itemKey: string, index: number) => void;
}) {
  const body = (() => {
    switch (seg.kind) {
      case "idea":
        return <div className="seg seg-idea">💭 <b>我的想法：</b>{renderInline(seg.text)}</div>;
      case "thought":
        return <div className="seg seg-thought">💭 {renderInline(seg.text)}</div>;
      case "callout":
        return (
          <div className={`callout callout-${seg.type}`}>
            <div className="callout-title">{seg.title || seg.type}</div>
            {seg.body && <div className="callout-body">{renderInline(seg.body)}</div>}
          </div>
        );
      case "image":
        return <img className="seg-img" src={imgSrc(seg.name)} alt={seg.name} loading="lazy" />;
      case "link":
        return (
          <a className="seg-link" href={seg.url}>
            {seg.text}
          </a>
        );
      default:
        return <div className="seg">{renderInline(seg.text)}</div>;
    }
  })();

  return (
    <div className="seg-wrap">
      {body}
      {seg.kind !== "image" && (
        <span className="seg-tools">
          <button className="icon-btn" title="编辑" onClick={() => onEdit(seg, itemKey, index)}>✎</button>
          <button className="icon-btn danger" title="删除" onClick={() => onDelete(seg, itemKey, index)}>🗑</button>
        </span>
      )}
      {seg.kind === "image" && (
        <span className="seg-tools">
          <button className="icon-btn danger" title="删除图片" onClick={() => onDelete(seg, itemKey, index)}>🗑</button>
        </span>
      )}
    </div>
  );
}

export default function NoteView({ file, anchor, onBack }: { file: string; anchor?: string; onBack: () => void }) {
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<EditCtx | null>(null);
  const [calloutForm, setCalloutForm] = useState<string | null>(null); // itemKey
  const [calloutDraft, setCalloutDraft] = useState({ type: "example", title: "", body: "" });
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string>("");

  // AI 面板（M4）
  const [ai, setAi] = useState<{ itemKey: string; heading: string; quote: string; chapter: string } | null>(null);
  const [messages, setMessages] = useState<{ role: "user" | "ai"; content: string }[]>([]);
  const [draftQ, setDraftQ] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [preview, setPreview] = useState<{ itemKey: string; q: string; a: string; type: string } | null>(null);

  // 同段共鸣（P1-4）：热门划线归属 + 公开想法，只展示不落盘，点「引入」才写入
  const [reso, setReso] = useState<ResonanceData | null>(null);
  const [resoLoading, setResoLoading] = useState(false);
  const [resoOpen, setResoOpen] = useState<Set<string>>(new Set());
  const [topOpen, setTopOpen] = useState(false);

  useEffect(() => {
    setReso(null);
    setResoOpen(new Set());
    setTopOpen(false);
    api.getNote(file).then((n) => {
      setNote(n);
      if (n.meta.bookId) {
        setResoLoading(true);
        api.resonance(file).then(setReso).catch(() => setReso(null)).finally(() => setResoLoading(false));
      }
    }).catch((e) => setError((e as Error).message));
  }, [file]);

  // 搜索结果跳转定位（等笔记渲染完成后滚动一次）
  useEffect(() => {
    if (note && anchor) {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ block: "start" });
    }
  }, [note, anchor]);

  const run = async (ops: unknown[]) => {
    setBusy(true);
    try {
      await api.edit(file, ops);
      setNote(await api.getNote(file));
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const syncThis = async () => {
    if (!note?.meta.bookId) return;
    setSyncing(true);
    try {
      await api.sync(note.meta.bookId);
      setNote(await api.getNote(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const startEdit = (seg: Segment, itemKey: string, index: number) => {
    if (seg.kind === "image") return;
    setEditing({
      itemKey,
      index,
      kind: seg.kind,
      type: seg.kind === "callout" ? seg.type : undefined,
      title: seg.kind === "callout" ? seg.title : undefined,
      text: seg.kind === "callout" ? seg.body : seg.text,
    });
  };

  const saveEdit = () => {
    if (!editing) return;
    const seg =
      editing.kind === "callout"
        ? { kind: "callout", calloutType: editing.type, title: editing.title, text: editing.text }
        : { kind: editing.kind, text: editing.text };
    setEditing(null);
    run([{ type: "updateSegment", itemKey: editing.itemKey, index: editing.index, segment: seg }]);
  };

  const deleteSeg = (seg: Segment, itemKey: string, index: number) => {
    const label = seg.kind === "idea" ? "这条想法" : seg.kind === "callout" ? "这个批注" : "这段内容";
    const warn = note?.meta.bookId && seg.kind === "idea" ? "\n（来自微信读书，删除后同步不会再恢复）" : "";
    if (!window.confirm(`确定删除${label}？${warn}`)) return;
    run([{ type: "deleteSegment", itemKey, index }]);
  };

  const deleteItem = (item: NoteItem) => {
    const warn = note?.meta.bookId ? "\n删除后该条目不会再被同步恢复。" : "";
    if (!window.confirm(`确定删除整个条目「${item.heading}」？${warn}`)) return;
    run([{ type: "deleteItem", itemKey: item.key }]);
  };

  const editQuote = (item: NoteItem) => {
    const text = window.prompt("修改原文（每行一段）：", item.quote.join("\n"));
    if (text == null) return;
    run([{ type: "editQuote", itemKey: item.key, text }]);
  };

  const uploadImage = (itemKey: string) => {
    uploadTarget.current = itemKey;
    fileInput.current?.click();
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const itemKey = uploadTarget.current || (note?.chapters[0]?.items[0]?.key ?? ORPHAN_KEY);
    setBusy(true);
    try {
      const data: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(",")[1] || "");
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      const { name } = await api.uploadImage(file, f.name, data);
      await api.edit(file, [{ type: "insertImage", itemKey, afterIndex: null, name }]);
      setNote(await api.getNote(file));
    } catch (err) {
      alert(`图片上传失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  // ---- 同段共鸣（P1-4）----
  const toggleReso = (itemKey: string) => {
    setResoOpen((s) => {
      const n = new Set(s);
      if (n.has(itemKey)) n.delete(itemKey);
      else n.add(itemKey);
      return n;
    });
  };

  const ideaImported = (item: NoteItem, idea: ResonanceIdea) =>
    item.extras.some((e) => e.kind === "callout" && (e as { body?: string }).body === idea.content);

  // 引入确认用两步按钮而非 window.confirm（嵌入式浏览器不弹原生对话框）
  const [confirmIdea, setConfirmIdea] = useState<string | null>(null);
  const ideaKey = (idea: ResonanceIdea) => `${idea.author}::${idea.content}`;

  const importIdea = (itemKey: string, idea: ResonanceIdea) => {
    setConfirmIdea(null);
    const seg = {
      kind: "callout",
      calloutType: "quote",
      title: `💬 读者共鸣 · ${idea.author}（${idea.date || "微信读书"}）`,
      text: idea.content,
    };
    run([{ type: "insertSegment", itemKey, afterIndex: null, segment: seg }]);
  };

  // ---- AI（M4）：对话历史持久化在服务端，同一条目跨刷新续接 ----
  const openAI = (item: NoteItem, chapterTitle: string) => {
    setAi({ itemKey: item.key, heading: item.heading, quote: item.quote.join("\n").slice(0, 120), chapter: chapterTitle });
    setMessages([]);
    setAiError("");
    api.chatHistory(file, item.key).then((h) => setMessages(h.messages)).catch(() => {});
  };

  const askAI = async () => {
    if (!ai || !draftQ.trim() || aiBusy) return;
    const q = draftQ.trim();
    setDraftQ("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setAiBusy(true);
    setAiError("");
    const publicIdeas = (reso?.matched[ai.itemKey]?.ideas || []).map((i) => `${i.author}：${i.content}`);
    try {
      const { messages } = await api.chat(file, ai.itemKey, q, publicIdeas);
      setMessages(messages);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const openPreview = (index: number) => {
    const m = messages[index];
    const q = messages[index - 1]?.role === "user" ? messages[index - 1].content : "（追问）";
    setPreview({ itemKey: ai?.itemKey || "", q, a: m.content, type: "example" });
  };

  // 清空该条目的服务端对话，从头开始（两步确认，嵌入式浏览器不弹原生框）
  const resetChat = async () => {
    setConfirmClear(false);
    if (!ai) return;
    try {
      await api.clearChat(file, ai.itemKey);
      setMessages([]);
    } catch (e) {
      setAiError((e as Error).message);
    }
  };

  const confirmInsertAI = () => {
    if (!preview) return;
    const p = (n: number) => String(n).padStart(2, "0");
    const d = new Date();
    const date = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
    const title = preview.type === "example" ? `🤖 AI 分析（Claude · ${date}）` : `🧠 延伸思考（Claude · ${date}）`;
    const seg = { kind: "callout", calloutType: preview.type, title, text: `**问：** ${preview.q}\n\n**答：** ${preview.a}` };
    setPreview(null);
    run([{ type: "insertSegment", itemKey: preview.itemKey, afterIndex: null, segment: seg }]);
  };

  if (error)
    return (
      <div className="page">
        <div className="empty">加载失败：{error}</div>
        <button className="btn" onClick={onBack}>返回书架</button>
      </div>
    );
  if (!note) return <div className="page"><div className="empty">加载中…</div></div>;

  const bookId = note.meta.bookId;
  const syncedNote = !!bookId;

  const itemTools = (item: NoteItem, chapterTitle: string) => (
    <div className="item-tools">
      <button className="btn tiny ai-btn" disabled={busy} title="就这条内容向 AI 提问" onClick={() => openAI(item, chapterTitle)}>🤖 AI</button>
      <button className="btn tiny" disabled={busy} title="在原文下加一条我的思考" onClick={() => run([{ type: "insertSegment", itemKey: item.key, afterIndex: null, segment: { kind: "thought", text: window.prompt("我的思考：") || "" } }])}>＋思考</button>
      <button className="btn tiny" disabled={busy} onClick={() => { setCalloutForm(item.key); setCalloutDraft({ type: "example", title: "", body: "" }); }}>＋批注</button>
      <button className="btn tiny" disabled={busy} onClick={() => uploadImage(item.key)}>＋图片</button>
      {!syncedNote && (
        <button className="btn tiny" disabled={busy} onClick={() => editQuote(item)}>✎原文</button>
      )}
      <button className="btn tiny danger-text" disabled={busy} onClick={() => deleteItem(item)}>🗑</button>
    </div>
  );

  const segHandlers = {
    onEdit: startEdit,
    onDelete: deleteSeg,
  };

  return (
    <div className={`note-layout${ai ? " ai-open" : ""}`}>
      <input ref={fileInput} type="file" accept="image/*" hidden onChange={onFilePicked} />
      <aside className="sidebar">
        <button className="btn back" onClick={onBack}>← 返回书架</button>
        <div className="sidebar-book">
          <div className="sidebar-title" title={note.bookTitle}>{note.bookTitle}</div>
          <div className="sidebar-meta">
            <span className={`chip ${note.meta.status === "读完" ? "green" : "blue"}`}>{note.meta.status}</span>
            <span className="chip plain">{note.meta.progress || 0}%</span>
            {busy && <span className="chip orange">保存中…</span>}
            {resoLoading && <span className="chip orange">🔥 共鸣加载中…</span>}
          </div>
          <div className="sidebar-actions">
            {bookId && (
              <>
                <button className="btn small" disabled={syncing} onClick={syncThis}>
                  {syncing ? "同步中…" : "⟳ 同步此书"}
                </button>
                <a className="btn small weread-link" href={`weread://reading?bId=${bookId}`}>在微信读书打开</a>
              </>
            )}
          </div>
        </div>
        <nav className="ch-nav">
          {note.chapters.map((c) => (
            <button key={c.id} className="ch-nav-item" onClick={() => jump(c.id)}>
              <span className="ch-nav-num">{c.num}</span>
              <span className="ch-nav-title">{c.title}</span>
              <span className="ch-nav-count">{c.items.length}</span>
            </button>
          ))}
          {note.orphans.length > 0 && (
            <button className="ch-nav-item" onClick={() => jump("orphans")}>
              <span className="ch-nav-num">💭</span>
              <span className="ch-nav-title">仅想法</span>
              <span className="ch-nav-count">{note.orphans.length}</span>
            </button>
          )}
        </nav>
      </aside>

      <main className="note-main">
        <h1 className="note-title">{note.bookTitle}</h1>
        {note.headerMeta && <div className="note-header-meta">{renderInline(note.headerMeta)}</div>}
        {note.chapters.map((c: NoteChapter) => (
          <section className="chapter" key={c.id} id={c.id}>
            <h2>
              {c.num && <span className="ch-num">{c.num}、</span>}
              {c.title}
            </h2>
            <div className="ch-meta">
              {c.jumpUrl && (
                <a href={c.jumpUrl} className="jump-link">↗ 跳转章节</a>
              )}
              {c.stats && <span>{c.stats}</span>}
            </div>
            {c.items.map((it) => (
              <article className={`item ${it.type}`} id={it.id} key={it.id}>
                <div className="item-head-row">
                  <div className="item-heading">{it.heading}</div>
                  {itemTools(it, `${c.num ? c.num + "、" : ""}${c.title}`)}
                </div>
                {it.quote.length > 0 && (
                  <blockquote className="quote">
                    {it.quote.map((l, i) => (
                      <p key={i}>{renderInline(l)}</p>
                    ))}
                  </blockquote>
                )}
                {reso?.matched[it.key] && (
                  <div className="reso-wrap">
                    <button className="reso-badge" onClick={() => toggleReso(it.key)}>
                      🔥 {reso.matched[it.key].count} 人划过这段
                      {reso.matched[it.key].ideas.length > 0 && ` · ${reso.matched[it.key].ideas.length} 条想法`}
                      <span className="reso-arrow">{resoOpen.has(it.key) ? "▾" : "▸"}</span>
                    </button>
                    {resoOpen.has(it.key) && (
                      <div className="reso-panel">
                        {reso.matched[it.key].ideas.length === 0 && (
                          <div className="reso-empty">很多读者划了这段，但还没有人发表想法。</div>
                        )}
                        {reso.matched[it.key].ideas.map((idea, k) => (
                          <div className="reso-idea" key={k}>
                            <div className="reso-idea-meta">
                              <b>{idea.author}</b>
                              {idea.date && <span className="reso-date">{idea.date}</span>}
                              {ideaImported(it, idea) ? (
                                <button className="btn tiny" disabled title="已引入过这条想法">已引入</button>
                              ) : confirmIdea === ideaKey(idea) ? (
                                <>
                                  <button className="btn tiny" onClick={() => setConfirmIdea(null)}>取消</button>
                                  <button className="btn tiny primary" disabled={busy} onClick={() => importIdea(it.key, idea)}>确认引入 ⇩</button>
                                </>
                              ) : (
                                <button
                                  className="btn tiny"
                                  disabled={busy}
                                  title="以 💬 读者共鸣 callout 写入笔记（追加，不改历史）"
                                  onClick={() => setConfirmIdea(ideaKey(idea))}
                                >
                                  引入 ⇩
                                </button>
                              )}
                            </div>
                            <div className="reso-idea-body">{renderInline(idea.content)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="extras">
                  {it.extras.map((s, i) =>
                    editing && editing.itemKey === it.key && editing.index === i ? (
                      <div className="edit-box" key={i}>
                        {editing.kind === "callout" && (
                          <input
                            className="input full"
                            value={editing.title || ""}
                            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                            placeholder="批注标题（如 🤖 AI 分析（Claude · 2026.08.24））"
                          />
                        )}
                        <textarea
                          rows={Math.min(12, Math.max(3, editing.text.split("\n").length + 1))}
                          value={editing.text}
                          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                        />
                        <div className="edit-actions">
                          <button className="btn small" onClick={() => setEditing(null)}>取消</button>
                          <button className="btn small primary" disabled={busy} onClick={saveEdit}>保存</button>
                        </div>
                      </div>
                    ) : (
                      <SegmentView key={i} seg={s} itemKey={it.key} index={i} {...segHandlers} />
                    )
                  )}
                  {calloutForm === it.key && (
                    <div className="edit-box">
                      <div className="callout-form-row">
                        <select className="input" value={calloutDraft.type} onChange={(e) => setCalloutDraft({ ...calloutDraft, type: e.target.value })}>
                          <option value="example">example · AI分析</option>
                          <option value="tip">tip · 延伸思考</option>
                          <option value="info">info · 信息补充</option>
                          <option value="warning">warning · 注意</option>
                        </select>
                        <input className="input" placeholder="标题（可选）" value={calloutDraft.title} onChange={(e) => setCalloutDraft({ ...calloutDraft, title: e.target.value })} />
                      </div>
                      <textarea rows={4} placeholder="批注正文…" value={calloutDraft.body} onChange={(e) => setCalloutDraft({ ...calloutDraft, body: e.target.value })} />
                      <div className="edit-actions">
                        <button className="btn small" onClick={() => setCalloutForm(null)}>取消</button>
                        <button
                          className="btn small primary"
                          disabled={busy || !calloutDraft.body.trim()}
                          onClick={() => {
                            const seg = { kind: "callout", calloutType: calloutDraft.type, title: calloutDraft.title, text: calloutDraft.body };
                            setCalloutForm(null);
                            run([{ type: "insertSegment", itemKey: it.key, afterIndex: null, segment: seg }]);
                          }}
                        >
                          插入
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </section>
        ))}

        {note.orphans.length > 0 && (
          <section className="chapter" id="orphans">
            <h2>💭 仅想法（无对应划线）</h2>
            <div className="extras orphans">
              {note.orphans.map((s, i) =>
                editing && editing.itemKey === ORPHAN_KEY && editing.index === i ? (
                  <div className="edit-box" key={i}>
                    <textarea rows={4} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                    <div className="edit-actions">
                      <button className="btn small" onClick={() => setEditing(null)}>取消</button>
                      <button className="btn small primary" disabled={busy} onClick={saveEdit}>保存</button>
                    </div>
                  </div>
                ) : (
                  <SegmentView key={i} seg={s} itemKey={ORPHAN_KEY} index={i} {...segHandlers} />
                )
              )}
            </div>
          </section>
        )}

        <div className="orphan-actions">
          <button
            className="btn small"
            disabled={busy}
            onClick={() => run([{ type: "insertSegment", itemKey: ORPHAN_KEY, afterIndex: null, segment: { kind: "orphanIdea", text: window.prompt("新的想法：") || "" } }])}
          >
            ＋ 添加想法（无对应划线）
          </button>
        </div>

        {reso && reso.others.length > 0 && (
          <section className="chapter reso-top">
            <h2 onClick={() => setTopOpen(!topOpen)} className="reso-top-h" title="微信读书全书热门划线 TOP20 中你没有划过的部分">
              🔥 本书热门划线 · 你没划过的 {reso.others.length} 条 <span className="reso-arrow">{topOpen ? "▾" : "▸"}</span>
            </h2>
            {topOpen &&
              reso.others.map((t, i) => (
                <div className="reso-top-item" key={i}>
                  <div className="reso-top-count">{t.count} 人划过</div>
                  <blockquote className="quote">{renderInline(t.text)}</blockquote>
                  {t.ideas.length > 0 && (
                    <div className="reso-top-ideas">
                      {t.ideas.slice(0, 3).map((idea, k) => (
                        <div className="reso-idea" key={k}>
                          <div className="reso-idea-meta">
                            <b>{idea.author}</b>
                            {idea.date && <span className="reso-date">{idea.date}</span>}
                          </div>
                          <div className="reso-idea-body">{renderInline(idea.content)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </section>
        )}

        <footer className="note-footer">
          上次同步：{note.meta.synced_at || "—"} ｜ 共 {note.counts.highlights} 条划线 · {note.counts.ideas + note.counts.thoughts} 条想法
          {note.counts.callouts > 0 && ` · ${note.counts.callouts} 个批注块`}
          {syncedNote && " ｜ 划线原文由同步管理"}
        </footer>
      </main>

      {ai && (
        <aside className="ai-panel">
          <div className="ai-header">
            <div className="ai-ctx">
              <div className="ai-ctx-title">🤖 AI 对话 · {ai.heading}</div>
              <div className="ai-ctx-sub" title={ai.quote}>{ai.chapter} ｜ {ai.quote || "（无原文）"}…</div>
              {(reso?.matched[ai.itemKey]?.ideas.length || 0) > 0 && (
                <div className="ai-ctx-reso">🔥 已附 {reso!.matched[ai.itemKey].ideas.length} 条读者想法作对照参考</div>
              )}
            </div>
            {messages.length > 0 && !confirmClear && (
              <button className="btn tiny" title="清空该条目的历史对话，从头开始" onClick={() => setConfirmClear(true)}>清空重开</button>
            )}
            {confirmClear && (
              <>
                <button className="btn tiny" onClick={() => setConfirmClear(false)}>取消</button>
                <button className="btn tiny danger-text" disabled={busy} onClick={resetChat}>确认清空</button>
              </>
            )}
            <button className="icon-btn" onClick={() => { setAi(null); setMessages([]); setConfirmClear(false); }}>✕</button>
          </div>
          <div className="ai-thread">
            {messages.length > 0 && (
              <div className="ai-resume">↩ 接着上次 · 已有 {Math.ceil(messages.length / 2)} 轮（服务端保留，刷新不丢）</div>
            )}
            {messages.length === 0 && !aiBusy && (
              <div className="ai-hint">就这条内容提问，例如：<br />「这段和我之前读的 HBM 瓶颈有什么联系？」<br />「用通俗的话解释这个概念」<br />「这个论点有没有反面证据？」<br />「其他读者的观点有道理吗？」</div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <div className="msg-body">{renderInline(m.content)}</div>
                {m.role === "ai" && (
                  <button className="btn tiny" onClick={() => openPreview(i)}>插入笔记 ⇩</button>
                )}
              </div>
            ))}
            {aiBusy && <div className="msg ai"><div className="msg-body typing">思考中…（约十几秒，Claude 正在作答）</div></div>}
            {aiError && <div className="ai-error">出错：{aiError}</div>}
          </div>
          <div className="ai-input">
            <textarea
              rows={2}
              placeholder="输入问题，Enter 发送…"
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  askAI();
                }
              }}
            />
            <button className="btn primary" disabled={aiBusy || !draftQ.trim()} onClick={askAI}>
              {aiBusy ? "…" : "发送"}
            </button>
          </div>
        </aside>
      )}

      {preview && (
        <div className="modal-mask" onClick={() => setPreview(null)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <h3>插入为批注（只追加，不改历史）</h3>
            <div className="callout-form-row">
              <select className="input" value={preview.type} onChange={(e) => setPreview({ ...preview, type: e.target.value })}>
                <option value="example">example · 🤖 AI 分析</option>
                <option value="tip">tip · 🧠 延伸思考</option>
              </select>
            </div>
            <pre className="md-preview">{`> [!${preview.type}] ${preview.type === "example" ? "🤖 AI 分析" : "🧠 延伸思考"}（Claude · 日期）\n> **问：** ${preview.q}\n>\n> **答：** ${preview.a}`}</pre>
            <div className="modal-actions">
              <button className="btn" onClick={() => setPreview(null)}>取消</button>
              <button className="btn primary" disabled={busy} onClick={confirmInsertAI}>确认插入</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
