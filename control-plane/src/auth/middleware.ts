import type { NextFunction, Request, Response } from "express";
import type { Role } from "@orchestrator/shared";

export interface AuthenticatedRequest extends Request {
  role?: Role;
  token?: string;
}

export function createAuthMiddleware(tokenMap: Map<string, Role>) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction): void => {
    const header = request.header("authorization");
    const headerToken = header?.startsWith("Bearer ") ? header.replace("Bearer ", "").trim() : "";
    const queryToken =
      typeof request.query.token === "string" ? request.query.token.trim() : "";
    const token = headerToken || queryToken;

    if (!token) {
      response.status(401).json({ error: "Missing bearer token." });
      return;
    }
    const role = tokenMap.get(token);
    if (!role) {
      response.status(403).json({ error: "Invalid token." });
      return;
    }
    request.token = token;
    request.role = role;
    next();
  };
}

export function requireRole(roles: Role[]) {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction): void => {
    if (!request.role || !roles.includes(request.role)) {
      response.status(403).json({ error: "Insufficient permissions." });
      return;
    }
    next();
  };
}
