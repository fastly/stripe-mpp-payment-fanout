import { createFanoutHandoff } from "fastly:fanout";

export interface FanoutRuntimeConfig {
  fanoutServiceId: string;
  fastlyApiToken: string;
}

interface PublishOptions {
  id?: string;
  previousId?: string;
  close?: boolean;
}

interface FanoutItem {
  channel: string;
  id?: string;
  "prev-id"?: string;
  formats: {
    "http-stream": {
      content?: string;
      action?: "close";
    };
  };
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

export function isValidFanoutSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

export function fanoutChannelName(sessionId: string): string {
  if (!isValidFanoutSessionId(sessionId)) {
    throw new Error("Invalid Fanout session id");
  }
  return `tempo-session-${sessionId}`;
}

export function handleTempoFanoutSubscription(request: Request, sessionId: string): Response {
  const channel = fanoutChannelName(sessionId);

  if (!request.headers.has("Grip-Sig")) {
    return createFanoutHandoff(request, "self");
  }

  const connected = `event: session\ndata: ${JSON.stringify({
    type: "fanout-connected",
    rail: "tempo",
    intent: "session",
    sessionId,
    delivery: "fastly-fanout",
  })}\n\n`;

  return new Response(connected, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "Grip-Hold": "stream",
      "Grip-Channel": channel,
      "Grip-Keep-Alive": ": keepalive\\n\\n; format=cstring; timeout=15",
      "X-MPP-Demo-Rail": "tempo",
      "X-MPP-Demo-Intent": "session",
      "X-MPP-Demo-Delivery": "fanout",
    },
  });
}

export async function publishTempoEvent(
  config: FanoutRuntimeConfig,
  sessionId: string,
  event: string,
  data: unknown,
  options: PublishOptions = {},
): Promise<void> {
  const item: FanoutItem = {
    channel: fanoutChannelName(sessionId),
    formats: {
      "http-stream": {
        content: `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
      },
    },
  };

  if (options.id) item.id = options.id;
  if (options.previousId) item["prev-id"] = options.previousId;

  await publish(config, [item]);

  if (options.close) {
    await closeTempoChannel(config, sessionId);
  }
}

export async function closeTempoChannel(
  config: FanoutRuntimeConfig,
  sessionId: string,
): Promise<void> {
  await publish(config, [
    {
      channel: fanoutChannelName(sessionId),
      formats: {
        "http-stream": {
          action: "close",
        },
      },
    },
  ]);
}

async function publish(config: FanoutRuntimeConfig, items: FanoutItem[]): Promise<void> {
  const body = JSON.stringify({ items });
  let response: Response;

  if (config.fanoutServiceId && config.fastlyApiToken) {
    response = await fetch(
      `https://api.fastly.com/service/${encodeURIComponent(config.fanoutServiceId)}/publish/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Fastly-Key": config.fastlyApiToken,
        },
        body,
      },
    );
  } else {
    response = await fetch("http://fanout-publish.local/publish/", {
      backend: "fanout_publish",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });
  }

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Fanout publish failed with ${response.status}${details ? `: ${details}` : ""}`,
    );
  }
}
