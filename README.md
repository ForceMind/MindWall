# MindWall锛堝績鍨ｏ級

MindWall 鏄竴涓?AI 涓粙鐨勯檶鐢熶汉绀句氦娌欑洅骞冲彴銆? 
鍦ㄢ€滅牬澹佲€濆墠锛屽弻鏂规秷鎭笉浼氱洿鎺ヤ簰浼狅紝鑰屾槸鍏堢粡杩?AI 瀹夊叏涓棿灞傚鏌ャ€佹嫤鎴垨鏀瑰啓鍚庡啀鎶曢€掋€?
## 椤圭洰缁撴瀯

- `apps/web`锛歂ext.js 鍓嶇锛堢敤鎴烽〉 + 绠＄悊椤碉級
- `apps/api`锛歂estJS 鍚庣锛堟帴鍙ｃ€佸尮閰嶅紩鎿庛€乄ebSocket銆佷腑闂村眰锛?- `infra`锛氬熀纭€璁炬柦閰嶇疆锛圥ostgreSQL/Redis锛?- `scripts`锛氫竴閿惎鍔ㄤ笌涓€閿儴缃叉洿鏂拌剼鏈?
## 鎶€鏈爤

- 鍓嶇锛歂ext.js + TypeScript + Tailwind CSS
- 鍚庣锛歂estJS + TypeScript
- 鏁版嵁搴擄細PostgreSQL + Prisma + pgvector
- 缂撳瓨/瀹炴椂锛歊edis + 鍘熺敓 WebSocket
- AI锛歄penAI锛堟敮鎸佸悗鍙板姩鎬侀厤缃級

## 鏈湴涓€閿惎鍔?
Windows PowerShell锛?
```powershell
.\scripts\start-local.ps1
```

Windows 鍙屽嚮鍚姩锛?
```text
scripts\start-local.cmd
```

鍙€夊弬鏁帮細

```powershell
.\scripts\start-local.ps1 -SkipInstall -SkipMigrate -NoDocker
```

鑴氭湰榛樿娴佺▼锛?
1. 鍚姩 PostgreSQL + Redis锛圖ocker Compose锛?2. 瀹夎 API/Web 渚濊禆
3. 鎵ц Prisma generate + migrate deploy
4. 鍚姩 API 涓?Web 寮€鍙戞湇鍔?
榛樿鍦板潃锛?
- API锛歚http://localhost:3100`
- Web锛歚http://localhost:3001`

## 鍚庡彴閰嶇疆锛圓I Key銆佹ā鍨嬨€佽法鍩燂級

MindWall 宸叉敮鎸佲€滃悗鍙颁笌鍓嶅彴鍒嗙鈥濈殑杩愯鏃堕厤缃柟寮忋€?
1. 鍦ㄧ幆澧冨彉閲忚缃悗鍙板彛浠わ細
   - 鏍圭洰褰?`.env` 鎴?`apps/api/.env`
   - `ADMIN_TOKEN=your-secret-token`
2. 鍚姩鍚庤闂鐞嗛〉锛?   - `http://localhost:3001/admin`
3. 鍦ㄧ鐞嗛〉濉啓骞朵繚瀛橈細
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`
   - `OPENAI_EMBEDDING_MODEL`
   - `WEB_ORIGIN`

鍚庣绠＄悊鎺ュ彛锛?
- `GET /admin/config`
- `PUT /admin/config`
- 璇锋眰澶村繀椤诲甫锛歚x-admin-token: <ADMIN_TOKEN>`

杩愯鏃堕厤缃枃浠讹細

- `apps/api/config/runtime-config.json`

浼樺厛绾ц鍒欙細

- 鍚庡彴杩愯鏃堕厤缃?> 鐜鍙橀噺

璇存槑锛?
- 鐢ㄦ埛椤甸潰锛歚/`銆乣/matches`銆乣/sandbox`
- 绠＄悊椤甸潰锛歚/admin`
- API Key 浠呰繑鍥炶劚鏁忛瑙堬紝涓嶄細瀹屾暣涓嬪彂缁欏墠绔?
## 鏈嶅姟鍣ㄤ竴閿儴缃?鏇存柊

Linux锛?
```bash
chmod +x scripts/deploy-update.sh
./scripts/deploy-update.sh
```

鍙€夌幆澧冨彉閲忥細

- `BRANCH`锛堥粯璁?`main`锛?- `WEB_PORT`锛堥粯璁?`3001`锛?
绀轰緥锛?
```bash
BRANCH=main WEB_PORT=3101 ./scripts/deploy-update.sh
```

Windows Server锛?
```powershell
.\scripts\deploy-update.ps1 -Branch main -WebPort 3001
```

閮ㄧ讲鑴氭湰榛樿娴佺▼锛?
1. 鎷夊彇鐩爣鍒嗘敮鏈€鏂颁唬鐮?2. 鍚姩鎴栨洿鏂?PostgreSQL + Redis
3. 瀹夎渚濊禆锛坄npm ci`锛?4. Prisma generate + migrate deploy
5. 鏋勫缓 API 涓?Web
6. 鑻ュ瓨鍦?`pm2`锛岃嚜鍔ㄩ噸鍚?`mindwall-api` 涓?`mindwall-web`

## 鏍稿績娴佺▼涓庢帴鍙?
### 1锛夊叆鍦鸿璋堬紙Onboarding锛?
- `POST /onboarding/sessions`
  - 璇锋眰浣擄細`{ "auth_provider_id": "鍙€?, "city": "鍙€? }`
  - 杩斿洖锛氶杞棶棰樸€乣session_id`銆乣user_id`
- `POST /onboarding/sessions/:sessionId/messages`
  - 璇锋眰浣擄細`{ "message": "鍥炵瓟鍐呭" }`
  - 杩斿洖锛?    - 杩涜涓細涓嬩竴杞棶棰?    - 瀹屾垚锛歚public_tags` + `onboarding_summary`

璇存槑锛?
- 闅愯棌绯荤粺鏍囩瀛樺偍鍦?`user_tags` 鐨?`HIDDEN_SYSTEM`
- 瀵瑰 API 鍙繑鍥?`PUBLIC_VISIBLE`

### 2锛夊尮閰嶅紩鎿庯紙Match Engine锛?
- `POST /match-engine/run`
  - 鍙傛暟锛歚city`銆乣max_matches_per_user`銆乣min_score`銆乣dry_run`
  - 閫昏緫锛氬悓鍩庡垎缁?+ 鍚戦噺鐩镐技搴?+ 鏍囩閲嶅悎搴?+ 椋庨櫓鎯╃綒
- `GET /match-engine/users/:userId/matches`
  - 杩斿洖鐩茬洅鍖归厤鍗＄墖锛堝叕寮€鏍囩 + AI 鍖归厤鐞嗙敱锛?  - 涓嶈繑鍥炵湡瀹炲ご鍍忋€佸鍚?
### 3锛夋矙鐩掕亰澶╋紙Sandbox锛?
HTTP锛?
- `GET /sandbox/matches/:matchId/messages?user_id=<id>&limit=50`

WebSocket锛?
- 鍦板潃锛歚/ws/sandbox`
- 鍓嶇鐜鍙橀噺锛歚NEXT_PUBLIC_WS_BASE_URL`锛堥粯璁?`ws://localhost:3100`锛?
瀹㈡埛绔簨浠剁ず渚嬶細

- `{"type":"auth","user_id":"..."}`
- `{"type":"join_match","match_id":"..."}`
- `{"type":"fetch_history","match_id":"...","limit":50}`
- `{"type":"sandbox_message","match_id":"...","text":"..."}`

鏈嶅姟绔叧閿簨浠讹細

- `connected`銆乣auth_ok`銆乣join_ok`銆乣history`
- `sandbox_message`銆乣message_delivered`銆乣message_blocked`
- `resonance_update`銆乣wall_ready`銆乣error`
- `wall_state`銆乣wall_break_decision`銆乣wall_break_update`銆乣wall_broken`
- `direct_message`锛堢牬澹佸悗鐩磋繛锛?
### 4锛夌牬澹侊紙Wall Break锛?
瑙﹀彂鏉′欢锛?
- `resonance_score >= 100`

鏈哄埗锛?
- 鍙屾柟閮藉彂閫?`wall_break_decision` 涓?`accept=true`
- 杈炬垚鍚庯細
  - `matches.status -> wall_broken`
  - `user_profiles.is_wall_broken -> true`
  - 瀹㈡埛绔粠 `sandbox_message` 鍒囨崲鍒?`direct_message`

## 鍓嶇椤甸潰

- `/`锛氭柊鐢ㄦ埛璁胯皥鍏ュ彛
- `/matches`锛氱洸鐩掑尮閰嶉〉
- `/sandbox`锛氭矙鐩掕亰澶╅〉锛堟敮鎸佷竴閿繛鎺ュ苟杩涘叆鑱婂ぉ锛?- `/admin`锛氬悗鍙伴厤缃〉锛圓I Key銆佹ā鍨嬨€佽法鍩燂級

## 婕旂ず鍐掔儫娴嬭瘯

1. 鍚姩鏁版嵁搴撳苟杩愯杩佺Щ锛岀‘淇?API/Web 宸插惎鍔?2. 鍦?`apps/api` 鎵ц锛?
```bash
npm run seed:demo
```

3. 缁х画鎵ц锛?
```bash
npm run smoke:ws
```

楠岃瘉鍐呭锛?
- 娌欑洅娑堟伅鏀瑰啓/鎶曢€掗摼璺?- 鍏辨尟鍒嗚揪鍒板彲鐮村闃堝€?- 鍙屾柟鐮村鍚屾剰鐘舵€佹祦杞?- 鐮村鍚庣洿杩炴秷鎭€氳矾

## 甯歌闂

### 鍓嶇宸︿笅瑙?`N` 鎸夐挳鏄粈涔堬紵

杩欐槸 Next.js 寮€鍙戞ā寮忕殑 Dev Indicator锛堝紑鍙戝伐鍏峰叆鍙ｏ級锛屼笉鏄笟鍔″姛鑳姐€? 
椤圭洰宸插湪 `apps/web/next.config.ts` 涓€氳繃 `devIndicators: false` 鍏抽棴銆?