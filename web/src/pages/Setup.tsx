import { useEffect, useState } from "react";
import { api } from "../api";
import type { SetupStatus } from "../api";

/**
 * 首次运行向导 / 设置页。
 * wizard 模式：全屏，走完才能进入应用；settings 模式：弹窗内管理（key 留空 = 不修改）。
 */
export default function Setup({ mode, onDone }: { mode: "wizard" | "settings"; onDone: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [vault, setVault] = useState("../obsidian_cangku");
  const [keyResult, setKeyResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [vaultResult, setVaultResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.setupStatus().then((s) => {
      setStatus(s);
      if (s.vaultRoot) setVault(s.vaultRoot);
    }).catch((e) => setError((e as Error).message));
  }, []);

  const testKey = async () => {
    setKeyBusy(true);
    setKeyResult(null);
    try {
      const r = await api.setupTestKey(apiKey);
      setKeyResult({ ok: true, msg: `✓ key 有效，你的账号有 ${r.books} 本有笔记的书` });
    } catch (e) {
      setKeyResult({ ok: false, msg: `✗ ${(e as Error).message}` });
    } finally {
      setKeyBusy(false);
    }
  };

  const testVault = async () => {
    setVaultBusy(true);
    setVaultResult(null);
    try {
      const r = await api.setupTestVault(vault);
      if (!r.ok) setVaultResult({ ok: false, msg: `✗ 目录不存在（将按 ${r.abs} 查找）` });
      else if (r.looksLikeVault) setVaultResult({ ok: true, msg: `✓ 目录存在，是 Obsidian 库（${r.abs}）` });
      else setVaultResult({ ok: true, msg: `✓ 目录存在（未发现 .obsidian，也可用作纯文件夹）` });
    } catch (e) {
      setVaultResult({ ok: false, msg: `✗ ${(e as Error).message}` });
    } finally {
      setVaultBusy(false);
    }
  };

  const canSave =
    !!status &&
    !saveBusy &&
    ((mode === "wizard" ? keyResult?.ok : true) || (status.hasKey && !apiKey.trim())) &&
    (vaultResult?.ok || status.vaultOk);

  const save = async () => {
    setSaveBusy(true);
    setError("");
    try {
      // key 留空且已配置过 → 只保存路径；向导模式必填过 key
      await api.setupSave(apiKey.trim() ? { apiKey: apiKey.trim(), vaultRoot: vault.trim() } : { vaultRoot: vault.trim() });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaveBusy(false);
    }
  };

  const body = (
    <div className="setup">
      <div className="setup-head">
        <h2>{mode === "wizard" ? "欢迎使用微信读书笔记工作台" : "⚙ 设置"}</h2>
        {mode === "wizard" && <p className="sub">三步配置，一分钟完成。所有信息只保存在你这台电脑上。</p>}
      </div>

      <div className="setup-step">
        <div className="setup-step-title">
          <span className="setup-num">1</span> 微信读书 API key
          {status?.hasKey && <span className="chip green">已配置</span>}
        </div>
        <div className="setup-row">
          <input
            className="input full"
            type="password"
            placeholder={status?.hasKey ? "已保存（留空表示不修改）" : "wrk- 开头，微信读书 App → 设置 → 微信读书 Skill 获取"}
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setKeyResult(null); }}
          />
          <button className="btn" disabled={!apiKey.trim() || keyBusy} onClick={testKey}>
            {keyBusy ? "测试中…" : "测试连接"}
          </button>
        </div>
        {keyResult && <div className={`setup-result ${keyResult.ok ? "ok" : "err"}`}>{keyResult.msg}</div>}
        <div className="setup-hint">key 会过期——以后失效了回到这里换一个新的就行。</div>
      </div>

      <div className="setup-step">
        <div className="setup-step-title">
          <span className="setup-num">2</span> Obsidian 库路径
        </div>
        <div className="setup-row">
          <input
            className="input full"
            placeholder="你的 Obsidian 库文件夹，如 ../obsidian_cangku 或 K:/obsidian_cangku"
            value={vault}
            onChange={(e) => { setVault(e.target.value); setVaultResult(null); }}
          />
          <button className="btn" disabled={!vault.trim() || vaultBusy} onClick={testVault}>
            {vaultBusy ? "检测中…" : "检测路径"}
          </button>
        </div>
        {vaultResult && <div className={`setup-result ${vaultResult.ok ? "ok" : "err"}`}>{vaultResult.msg}</div>}
        <div className="setup-hint">推荐把本工具和库放在同一父目录（约定路径 ../obsidian_cangku），换电脑也不用改配置。</div>
      </div>

      <div className="setup-step">
        <div className="setup-step-title"><span className="setup-num">3</span> AI 对话（可选）</div>
        {status === null ? (
          <div className="setup-hint">检测中…</div>
        ) : status.claudeAvailable ? (
          <div className="setup-result ok">✓ 已检测到 claude CLI，AI 对话与延伸功能可用</div>
        ) : (
          <div className="setup-result">未检测到 claude CLI：AI 对话暂不可用，同步/浏览/编辑/热力图等其它功能不受影响。想用 AI 可安装 Claude Code（npm install -g @anthropic-ai/claude-code）后回来。</div>
        )}
      </div>

      {error && <div className="ai-error">出错：{error}</div>}

      <div className="setup-actions">
        <button className="btn primary" disabled={!canSave} onClick={save}>
          {saveBusy ? "保存中…" : mode === "wizard" ? "保存并进入 →" : "保存"}
        </button>
        {mode === "settings" && (
          <button className="btn" onClick={onDone}>取消</button>
        )}
      </div>
    </div>
  );

  if (mode === "wizard") return <div className="page setup-page">{body}</div>;
  return (
    <div className="modal-mask" onClick={onDone}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>{body}</div>
    </div>
  );
}
