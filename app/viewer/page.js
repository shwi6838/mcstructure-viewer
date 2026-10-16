"use client";

import dynamic from "next/dynamic";

// three.js touches the DOM/WebGL, so it can only run in the browser.
// ssr: false keeps Next from trying to render it on the server.
const ViewerWorkshop = dynamic(
  () => import("../../components/ViewerWorkshop"),
  { ssr: false }
);

export default function ViewerPage() {
  return <ViewerWorkshop />;
}