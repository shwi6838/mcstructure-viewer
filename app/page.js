import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 48, maxWidth: 640 }}>
      <h1>My Bedrock builds</h1>
      <p>
        This will become the gallery of saved builds. For now, jump straight
        into the viewer and drop in a <code>.mcstructure</code> file.
      </p>
      <Link href="/viewer">Open the viewer →</Link>
    </main>
  );
}
