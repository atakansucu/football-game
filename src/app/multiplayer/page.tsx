import Link from "next/link";
import { TopNav } from "@/components/TopNav";

const CARD =
  "flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-left transition active:scale-[0.99] hover:border-accent/40 hover:bg-accent/10";

export default function MultiplayerPage() {
  return (
    <main className="flex flex-1 flex-col gap-6">
      <TopNav />
      <div>
        <h1 className="text-3xl font-black uppercase">Multiplayer</h1>
        <p className="mt-1 text-white/50">Create a room or join a friend.</p>
      </div>

      <div className="space-y-3">
        <Link href="/create" className={CARD}>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-2xl">
            ➕
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-bold text-white">
              Create Game
            </span>
            <span className="block text-sm text-white/50">
              Set up a room and invite a friend
            </span>
          </span>
        </Link>

        <Link href="/join" className={CARD}>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-2xl">
            🔑
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-bold text-white">
              Join Game
            </span>
            <span className="block text-sm text-white/50">
              Enter a room code to join
            </span>
          </span>
        </Link>
      </div>
    </main>
  );
}
