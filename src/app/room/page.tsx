"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGameRoom } from "@/features/room/useGameRoom";
import { Lobby } from "@/features/room/Lobby";
import { GameScreen } from "@/features/game/GameScreen";
import { MatchResult } from "@/features/game/MatchResult";
import { TopNav } from "@/components/TopNav";

export default function RoomPage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 flex-col">
          <div className="flex flex-1 items-center justify-center">
            <p className="text-white/50">Loading room...</p>
          </div>
        </main>
      }
    >
      <RoomGate />
    </Suspense>
  );
}

function RoomGate() {
  const router = useRouter();
  const code = useSearchParams().get("code");

  function handleExit() {
    router.push("/");
  }

  if (!code) {
    return (
      <main className="flex flex-1 flex-col">
        <TopNav onExit={handleExit} />
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <p className="text-lg text-red-400">Room not found</p>
        </div>
      </main>
    );
  }

  return <RoomView code={code} onExit={handleExit} />;
}

function RoomView({ code, onExit }: { code: string; onExit: () => void }) {
  const api = useGameRoom(code);
  const leaveAndExit = () => {
    void api.leaveRoom().catch(() => {}).finally(onExit);
  };

  if (api.loading) {
    return (
      <main className="flex flex-1 flex-col">
        <TopNav onExit={onExit} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-white/50">Loading room...</p>
        </div>
      </main>
    );
  }

  if (api.error || !api.room) {
    return (
      <main className="flex flex-1 flex-col">
        <TopNav onExit={onExit} />
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <p className="text-lg text-red-400">
            {api.error ?? "Room not found"}
          </p>
        </div>
      </main>
    );
  }

  const status = api.room.status;
  const matchFinished = api.match?.status === "finished";

  let content: React.ReactNode;
  if (status === "finished" || matchFinished) {
    content = <MatchResult api={api} />;
  } else if (status === "playing" && api.match) {
    content = <GameScreen api={api} />;
  } else {
    content = <Lobby api={api} />;
  }

  return (
    <main className="flex flex-1 flex-col">
      <TopNav onExit={leaveAndExit} />
      {!api.online && (
        <p
          role="status"
          className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-center text-sm text-amber-200"
        >
          Connection lost. The game will resync when you are online.
        </p>
      )}
      {content}
    </main>
  );
}
