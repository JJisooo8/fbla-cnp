import { useEffect, useState } from "react";

export default function App() {
  const [msg, setMsg] = useState("Loading...");

  useEffect(() => {
    fetch("http://localhost:3001/api/health")
      .then((r) => r.json())
      .then((d) => setMsg(d.message))
      .catch(() => setMsg("Failed to reach backend"));
  }, []);

  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>LocalLink</h1>
      <p>Backend status: {msg}</p>
    </div>
  );
}
