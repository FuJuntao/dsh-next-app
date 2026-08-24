import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home",
  description: "The dsh home surface",
};

export default function HomePage() {
  return (
    <section>
      <h1>Home</h1>
      <p>
        Placeholder: pick a session from the side nav; the home surface lands with the chat story.
      </p>
    </section>
  );
}
