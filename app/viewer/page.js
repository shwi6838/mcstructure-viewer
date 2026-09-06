"use client";

import dynamic from "next/dynamic";

// three.js touches the DOM/WebGL, so it can only run in the browser.
// ssr: false keeps Next from trying to render it on the server.
const StructureViewer = dynamic(
  () => import("../../components/StructureViewer"),
  { ssr: false }
);

export default function ViewerPage() {
  return <StructureViewer />;
}
