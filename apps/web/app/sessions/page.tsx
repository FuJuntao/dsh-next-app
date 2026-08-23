import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sessions",
  description: "List of dsh sessions",
};

export default function SessionsPage() {
  return (
    <section>
      <h1>Sessions</h1>
      <p>Placeholder: the session list lands with the sessions surface story.</p>
    </section>
  );
}
