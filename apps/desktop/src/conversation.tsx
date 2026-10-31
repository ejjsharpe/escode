import React, { useState } from "react";
import Markdown from "react-markdown";

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [status, setStatus] = useState("");
  const code = React.isValidElement<{ children?: React.ReactNode }>(children) ? String(children.props.children ?? "") : "";
  return <div className="code-block"><button type="button" onClick={async () => {
    try { await navigator.clipboard.writeText(code.replace(/\n$/, "")); setStatus("Copied"); }
    catch { setStatus("Copy failed; select the code to copy it."); }
  }}>Copy code</button><span role="status">{status}</span><pre>{children}</pre></div>;
}

export function ConversationText({ text }: { text: string }) {
  return <div className="conversation-text"><Markdown skipHtml components={{ pre: CodeBlock }}>{text}</Markdown></div>;
}
