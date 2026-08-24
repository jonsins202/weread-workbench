import { useEffect, useState } from "react";
import Shelf from "./pages/Shelf";
import NoteView from "./pages/NoteView";
import Setup from "./pages/Setup";
import { api } from "./api";

export default function App() {
  const [route, setRoute] = useState<
    { page: "shelf" } | { page: "note"; file: string; anchor?: string }
  >({ page: "shelf" });
  const [nonce, setNonce] = useState(0);
  // 首次运行门控：未完成配置（key/库路径）先进入向导
  const [setup, setSetup] = useState<"loading" | "needed" | "done">("loading");

  useEffect(() => {
    api.setupStatus()
      .then((s) => setSetup(s.configured ? "done" : "needed"))
      .catch(() => setSetup("done")); // 状态接口异常时放行，由具体功能页报错
  }, []);

  if (setup === "loading") {
    return <div className="page"><div className="empty">加载中…</div></div>;
  }
  if (setup === "needed") {
    return (
      <Setup
        mode="wizard"
        onDone={() => {
          setSetup("done");
          setNonce((n) => n + 1);
        }}
      />
    );
  }

  if (route.page === "note") {
    return (
      <NoteView
        key={route.file + nonce}
        file={route.file}
        anchor={route.anchor}
        onBack={() => {
          setNonce((n) => n + 1);
          setRoute({ page: "shelf" });
        }}
      />
    );
  }
  return (
    <Shelf
      key={nonce}
      onOpen={(file, anchor) => setRoute({ page: "note", file, anchor })}
    />
  );
}
