import type { Metadata } from "next";

import { DshLogo } from "@/components/dsh-logo";
import { HomeComposerIsland } from "@/components/home-composer-island";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Home",
  description: "The dsh home surface",
};

export default function HomePage() {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      {/* The slogan never breaks mid-phrase: it steps down a size on small
          screens, and the Preview badge drops to its own centered line when
          the row runs out of room (whitespace-nowrap without the wrap would
          overflow the 320px floor the e2e pins). */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
        <DshLogo className="w-[2.125rem] shrink-0" />
        <h1 className="text-xl font-medium whitespace-nowrap sm:text-2xl">Into the Unknown</h1>
        <Badge variant="secondary">Preview</Badge>
      </div>
      <HomeComposerIsland />
    </section>
  );
}
