import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Session",
  description: "A dsh session",
};

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <section>
      <h1>Session {id}</h1>
      <p>
        Placeholder: the session detail surface - the hydrated chat island (ADR-0001) over SSE
        downlinks (ADR-0003) - lands with the chat story.
      </p>
    </section>
  );
}
