// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import { type NextRequest } from "next/server";
import { validateIdentifier } from "@/lib/validation";
import agentProcessManager from "../../../../../../server/agent-process-manager";
import type { AgentEvent } from "@/lib/agent-events";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const idErr = validateIdentifier(id, "id");
  if (idErr) {
    return new Response(JSON.stringify({ error: idErr }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send existing history as initial batch
      const history = agentProcessManager.getHistory(id);
      for (const event of history) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      // Send current status
      const status = agentProcessManager.getStatus(id);
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "status", data: { status } })}\n\n`),
      );

      // Subscribe to new events
      const unsubscribe = agentProcessManager.subscribe(id, (event: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          unsubscribe();
        }
      });

      // Heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 15_000);

      // Cleanup on abort
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
