# MindWall Web锛堝墠绔級

鏈洰褰曟槸 MindWall 鐨勫墠绔簲鐢紝鍩轰簬 Next.js锛圓pp Router锛夋瀯寤恒€? 
涓昏鍖呭惈鐢ㄦ埛娴佺▼椤甸潰锛堣璋堛€佸尮閰嶃€佹矙鐩掕亰澶╋級鍜屽悗鍙扮鐞嗛〉闈紙閰嶇疆 AI 鎺ュ彛锛夈€?
## 鍚姩鏂瑰紡

瀹夎渚濊禆锛?
```bash
npm install
```

寮€鍙戞ā寮忥紙榛樿 3000 绔彛锛夛細

```bash
npm run dev
```

鎸囧畾绔彛锛堟帹鑽?3001锛夛細

```bash
npm run dev -- -p 3001
```

鐢熶骇鏋勫缓锛?
```bash
npm run build
npm run start -- -p 3001
```

## 鐜鍙橀噺

寤鸿鍦?`apps/web/.env.local` 閰嶇疆锛?
```dotenv
NEXT_PUBLIC_API_BASE_URL="http://localhost:3100"
NEXT_PUBLIC_WS_BASE_URL="ws://localhost:3100"
```

璇存槑锛?
- `NEXT_PUBLIC_API_BASE_URL`锛氬墠绔姹傚悗绔?HTTP API 鐨勫湴鍧€
- `NEXT_PUBLIC_WS_BASE_URL`锛氬墠绔繛鎺?WebSocket 鐨勫熀纭€鍦板潃

## 椤甸潰璺敱

- `/`锛氭柊鐢ㄦ埛璁胯皥鍏ュ彛
- `/matches`锛氱洸鐩掑尮閰嶉〉
- `/sandbox`锛氭矙鐩掕亰澶╅〉
- `/admin`锛氬悗鍙伴厤缃〉锛堥渶绠＄悊鍛?Token锛?
## 鐢ㄦ埛娴佺▼锛堝綋鍓嶇増鏈級

1. 鍦?`/` 瀹屾垚鍏ュ満璁胯皥
2. 杩涘叆 `/matches` 杩愯鍖归厤骞舵煡鐪嬪€欓€夊璞?3. 浠庡尮閰嶅崱鐗囪繘鍏?`/sandbox` 瀵硅瘽
4. 鍏辨尟鍒嗚揪鍒伴槇鍊煎悗鍙彂璧风牬澹侊紝鐮村鍚庡垏鎹㈢洿杩炶亰澶?
## 寮€鍙戣鏄?
- 椤圭洰宸插叧闂?Next.js 寮€鍙戞寚绀哄櫒锛堝乏涓嬭 `N` 鎸夐挳锛?- 閰嶇疆浣嶇疆锛歚apps/web/next.config.ts` 鐨?`devIndicators: false`
