import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;
const log = new Logger('HTTP');

/** Reuses a safe incoming X-Request-ID (or creates one), echoes it in the response and logs one JSON line per request. */
export function requestId(options: { logRequests?: boolean } = {}) {
  const { logRequests = true } = options;
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header('x-request-id');
    const id = incoming && SAFE_ID.test(incoming) ? incoming : randomBytes(8).toString('hex');
    (req as Request & { id?: string }).id = id;
    res.setHeader('X-Request-ID', id);
    if (logRequests) {
      const started = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        log.log(JSON.stringify({ requestId: id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, durationMs: Math.round(ms * 10) / 10 }));
      });
    }
    next();
  };
}
