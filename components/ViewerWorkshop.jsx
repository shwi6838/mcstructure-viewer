"use client";

import { useRef, useState } from "react";
import StructureViewer from "./StructureViewer";
import { parseMcstructureFile } from "../lib/parseMcstructure";

/**
 * Workshop view: the shared StructureViewer plus the debug UI around it
 * (file input, stats, untextured block list, reset view). Everything in
 * here is workshop-only; the embeddable component will not include it by
 * default.
 */
export default function ViewerWorkshop() {
  const viewerRef = useRef(null);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showUntextured, setShowUntextured] = useState(false);

  async function handleFile(file) {
    setLoading(true);
    setError(null);
    setData(null);
    setShowUntextured(false);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const parsed = await parseMcstructureFile(arrayBuffer);
      if (parsed.blocks.length === 0) {
        setError("Parsed the file, but found no blocks to render.");
        return;
      }
      setData(parsed);
    } catch (err) {
      console.error(err);
      setError(
        "Could not parse this file. Confirm it's an uncompressed .mcstructure export."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ width: "100%", height: "100vh", position: "relative" }}>
      <div
        style={{
          position: "absolute",
          zIndex: 10,
          padding: 16,
          background: "rgba(255,255,255,0.9)",
          borderRadius: 8,
          margin: 16,
          maxWidth: 320,
          maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        <input
          type="file"
          accept=".mcstructure"
          onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])}
        />
        {loading && <p>Parsing structure…</p>}
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        {data && (
          <>
            <p>
              {data.blocks.length.toLocaleString()} blocks · {data.size.x}×
              {data.size.y}×{data.size.z}
            </p>
            <button onClick={() => viewerRef.current?.resetView()}>
              Reset view
            </button>
          </>
        )}
        {status?.texturesLoading && <p>Loading textures from bedrock-samples…</p>}
        {data && status && !status.texturesLoading && (
          <>
            <p>
              {status.texturedCount.toLocaleString()} blocks textured ·{" "}
              {status.untexturedCount.toLocaleString()} shown as color
            </p>
            {status.untexturedCount > 0 && (
              <button onClick={() => setShowUntextured((v) => !v)}>
                {showUntextured ? "Hide" : "Show"} untextured block names
              </button>
            )}
            {showUntextured && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                {status.untexturedCounts.map(([name, count]) => (
                  <li key={name}>
                    {name} × {count.toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <StructureViewer ref={viewerRef} data={data} onStatus={setStatus} />
    </div>
  );
}