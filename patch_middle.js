const fs = require('fs');
let content = fs.readFileSync('apps/api/src/sandbox/sandbox.service.ts', 'utf8');

const replacement = `private normalizeMiddlewareDecision(input: {
    aiAction: string | undefined;
    rewrittenText: string | undefined;
    hiddenTagUpdates: Record<string, number>;
    reason: string | undefined;
    originalText: string;
  }): MiddlewareDecision {
    const action = input.aiAction === 'blocked' ? 'blocked' : 'modified';
    
    let rewrittenBase = (input.rewrittenText || '').trim();
    if (!rewrittenBase || rewrittenBase === input.originalText) {
      // Force a summarize if AI failed to rewrite
      rewrittenBase = this.summarizeForRelay(input.originalText);
    }

    const rewrittenText = action === 'blocked'
      ? (input.rewrittenText || '').trim() || '消息已被安全中间层拦截。'
      : rewrittenBase;

    return {
      aiAction: action,
      rewrittenText: rewrittenText.slice(0, 2000),
      hiddenTagUpdates: input.hiddenTagUpdates || {},
      reason: (input.reason || '安全中间层判定').slice(0, 220),
    };
  }

  private fallbackMiddleware`;

content = content.replace(/private normalizeMiddlewareDecision\([\s\S]*?\}\n\s*private fallbackMiddleware/, replacement);
fs.writeFileSync('apps/api/src/sandbox/sandbox.service.ts', content);
console.log('patched sandbox');