import type { RuntimeConfig } from "./index";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = "2026-03-04.preview";

interface StripeRequestOptions {
  idempotencyKey?: string;
  [key: string]: unknown;
}

interface StripeLikeResponse {
  id?: string;
  object?: string;
  lastResponse?: {
    statusCode: number;
    headers: Record<string, string>;
  };
  error?: {
    message?: string;
  };
  [key: string]: unknown;
}

function appendFormValue(form: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendFormValue(form, `${key}[]`, item);
    }
    return;
  }

  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      appendFormValue(form, `${key}[${childKey}]`, childValue);
    }
    return;
  }

  form.append(key, String(value));
}

function toFormBody(params: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    appendFormValue(form, key, value);
  }
  return form;
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

async function stripePost(
  secretKey: string,
  path: string,
  params: Record<string, unknown>,
  options?: StripeRequestOptions,
): Promise<StripeLikeResponse> {
  const headers = new Headers({
    Authorization: `Basic ${btoa(`${secretKey}:`)}`,
    "Content-Type": "application/x-www-form-urlencoded",
    "Stripe-Version": STRIPE_API_VERSION,
  });

  if (options?.idempotencyKey) {
    headers.set("Idempotency-Key", options.idempotencyKey);
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: "POST",
    headers,
    body: toFormBody(params),
  });

  const text = await response.text();
  let parsed: StripeLikeResponse = {};
  if (text) {
    try {
      parsed = JSON.parse(text) as StripeLikeResponse;
    } catch {
      parsed = { raw: text };
    }
  }

  parsed.lastResponse = {
    statusCode: response.status,
    headers: headersToObject(response.headers),
  };

  if (!response.ok) {
    const errorMessage = parsed.error?.message || `Stripe API request failed with ${response.status}`;
    const error = new Error(errorMessage) as Error & { statusCode?: number; raw?: unknown };
    error.statusCode = response.status;
    error.raw = parsed;
    throw error;
  }

  return parsed;
}

export function createStripeRestClient(config: RuntimeConfig) {
  if (!config.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is required for Stripe MPP support");
  }

  return {
    paymentIntents: {
      create: (params: Record<string, unknown>, options?: StripeRequestOptions) =>
        stripePost(config.stripeSecretKey, "/payment_intents", params, options),
    },
  };
}

export async function createTestSharedPaymentToken(
  config: RuntimeConfig,
  args: {
    paymentMethod: string;
    amount: string;
    currency: string;
    expiresAt: number;
    networkId?: string;
    metadata?: Record<string, string>;
  },
): Promise<string> {
  if (!config.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is required to create a test Shared Payment Token");
  }

  const params: Record<string, unknown> = {
    payment_method: args.paymentMethod,
    usage_limits: {
      currency: args.currency,
      max_amount: args.amount,
      expires_at: args.expiresAt,
    },
  };

  if (args.metadata && Object.keys(args.metadata).length > 0) {
    params.metadata = args.metadata;
  }

  const result = await stripePost(
    config.stripeSecretKey,
    "/test_helpers/shared_payment/granted_tokens",
    params,
  );

  if (!result.id || typeof result.id !== "string") {
    throw new Error("Stripe did not return a Shared Payment Token id");
  }

  return result.id;
}
