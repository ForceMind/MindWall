# MindWall 后端重构架构（V2）

## 为什么重构
当前后端功能可用，但模块边界不清晰，业务流程与基础设施耦合较重，不利于长期演进。V2 重构目标是：
- 按“基础设施 / 领域 / 平台”三层组织代码
- 逐步替换旧实现而不是继续叠补丁
- 保持 API 兼容，前端可平滑迁移

## 新的顶层结构
`src/system` 作为新的组合入口：

- `foundation/`
  - `persistence.module.ts`（数据库/Prisma）
  - `observability.module.ts`（日志/AI 使用统计）
  - `foundation.module.ts`
- `domains/`
  - `identity/`（认证、会话）
  - `onboarding/`（访谈、画像）
  - `matching/`（匹配、联系人）
  - `conversation/`（沙盒聊天、陪练）
  - `domains.module.ts`
- `platform/`
  - `admin/`（后台管理能力）
  - `platform.module.ts`
- `backend-system.module.ts`

`AppModule` 只依赖 `BackendSystemModule`，不再直接拼接所有业务模块。

## 迁移策略（分阶段）
1. **阶段 A：重组入口与模块边界（已完成）**
   - 引入 `system` 目录与分层模块
   - `AppModule` 切换到新组合入口
2. **阶段 B：领域服务解耦**
   - 将各域服务拆分为：`application`（用例） + `infrastructure`（外部依赖）
   - controller 仅负责协议转换
3. **阶段 C：统一中间件与错误模型**
   - 统一 API 错误码和中文消息映射
   - 统一鉴权、审计日志、请求追踪
4. **阶段 D：可测试性与可观测性**
   - 单元测试覆盖用例层
   - 指标面板支持按功能统计错误率、延迟、成本

## 设计原则
- **API 兼容优先**：对前端路由和 payload 兼容，避免同时重写前后端。
- **边界清晰**：跨域访问必须经过明确接口，不直接“跨模块读写”。
- **状态可追踪**：关键状态变更（用户状态、匹配状态、破壁状态）必须可审计。
- **渐进替换**：允许旧逻辑暂时存在，但由新入口统一编排，逐步淘汰。
