"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestContextMiddleware = requestContextMiddleware;
const crypto_1 = require("crypto");
function requestContextMiddleware(req, res, next) {
    const incoming = String(req.headers['x-request-id'] || '').trim();
    const requestId = incoming || (0, crypto_1.randomUUID)();
    req.requestId = requestId;
    req.requestStartedAt = Date.now();
    res.setHeader('x-request-id', requestId);
    next();
}
//# sourceMappingURL=request-context.middleware.js.map