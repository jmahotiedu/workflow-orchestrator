import type { NextFunction, Request, Response } from "express";

type Entry = {
  count: number;
  resetAt: number;
};

export function createRateLimiter(limitPerMinute: number) {
  const entries = new Map<string, Entry>();
  const windowMs = 60_000;

  return (request: Request, response: Response, next: NextFunction): void => {
    const key =
      request.header("authorization")?.replace("Bearer ", "") ??
      request.ip ??
      request.socket.remoteAddress ??
      "anonymous";
    const now = Date.now();
    const existing = entries.get(key);

    if (!existing || now >= existing.resetAt) {
      entries.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (existing.count >= limitPerMinute) {
      response.status(429).json({ error: "Rate limit exceeded." });
      return;
    }

    existing.count += 1;
    next();
  };
}
