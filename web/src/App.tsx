import { useState } from "react";
import Shelf from "./pages/Shelf";
import NoteView from "./pages/NoteView";

export default function App() {
  const [route, setRoute] = useState<
    { page: "shelf" } | { page: "note"; file: string; anchor?: string }
  >({ page: "shelf" });
  const [nonce, setNonce] = useState(0);

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
