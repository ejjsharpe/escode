import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@base-ui/react/button";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import "./style.css";
declare global {
  interface Window {
    escode: { toolStatus(): Promise<unknown> };
    MonacoEnvironment: { getWorker(_: string, label: string): Worker };
  }
}
window.MonacoEnvironment = {
  getWorker: (_, label) => (label === "json" ? new JsonWorker() : new EditorWorker()),
};
const styles = stylex.create({
  page: {
    padding: 28,
    color: "#e5e7eb",
    backgroundColor: "#18202b",
    minHeight: "100vh",
    fontFamily: "system-ui",
  },
  button: { padding: 10, marginBottom: 16 },
  editor: { height: 280 },
  status: { whiteSpace: "pre-wrap" },
});
function App() {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Checking installed tools…");
  const refresh = () =>
    window.escode
      .toolStatus()
      .then((value) => setStatus(JSON.stringify(value, null, 2)))
      .catch(() => setStatus("Tool check failed. Restart the app and retry."));
  useEffect(() => {
    void refresh();
    const editor = monaco.editor.create(container.current!, {
      value: '{ "foundation": "escode" }',
      language: "json",
      automaticLayout: true,
      theme: "vs-dark",
    });
    return () => editor.dispose();
  }, []);
  return (
    <main {...stylex.props(styles.page)}>
      <h1>escode compatibility</h1>
      <p>Desktop foundation check · editing here is an unsaved scratch buffer.</p>
      <Button {...stylex.props(styles.button)} onClick={() => void refresh()}>
        Retry tool check
      </Button>
      <div
        ref={container}
        aria-label="Compatibility scratch editor"
        {...stylex.props(styles.editor)}
      />
      <pre aria-live="polite" {...stylex.props(styles.status)}>
        {status}
      </pre>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
