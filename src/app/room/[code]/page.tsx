"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useGameRoom } from "@/features/room/useGameRoom";
import { Lobby } from "@/features/room/Lobby";
import { GameScreen } from "@/features/game/GameScreen";
import { MatchResult } from "@/features/game/MatchResult";
import { TopNav } from "@/components/TopNav";

export default function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const api = useGameRoom(code);
  const router = useRouter();

  function handleExit() {
    if (
      window.confirm("Leave this game and return to the main menu?")
    ) {
      router.push("/");
    }
  }

  if (api.loading) {
    return (
      <main className="flex flex-1 flex-col py-2">
        <TopNav onExit={handleExit} />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-white/50">Loading room...</p>
        </div>
      </main>
    );
  }

  if (api.error || !api.room) {
    return (
      <main className="flex flex-1 flex-col py-2">
        <TopNav onExit={handleExit} />
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
    <main className="flex flex-1 flex-col py-2">
      <TopNav onExit={handleExit} />
      {content}
    </main>
  );
}
