import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Ecoa o `x-request-id` do cliente ou gera um; roda antes de tudo, então vale também nos erros. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  res.setHeader("x-request-id", incoming && incoming.length > 0 ? incoming : randomUUID());
  next();
}
