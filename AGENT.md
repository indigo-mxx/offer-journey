# 秋招同行录：智能体交接说明

> 本文件是给后续智能体的项目说明和工作约定。开始修改前请完整阅读，并先检查当前工作区状态。

## 1. 项目是什么

“秋招同行录”（品牌文案：`MXX · 秋招同行录`）是一个记录秋招、提前批、实习投递进度的 Web 工作台。目标用户是项目作者本人以及少量好友，核心目标是：

- 记录公司、岗位、Base 地点、投递批次、投递时间、渠道、链接、薪资、状态和备注；
- 一个公司有多个岗位时，可以按公司查看全部岗位，也可以按岗位、地点筛选；
- 公司支持多个行业标签（例如半导体、具身智能、智驾、软件、游戏、汽车、国企、事业单位、研究院、金融、生物医药、化工、能源电力等）和自定义标签；
- 在岗位详情弹窗中管理面试安排、面试开始/结束时间、轮次、形式、面试官、结果、简要面经和下一步；
- 支持本地模式、登录后的 Supabase 云端同步、共享小组、邀请链接和逐条隐私控制；
- 提供数据分析、个人中心、共享视图等辅助界面。

这是个人效率工具，不要擅自扩展成复杂的招聘 SaaS。优先保证单人记录稳定、数据不丢、共享权限正确和手机端可用。

## 2. 当前技术和正式服务

- 前端：React + TypeScript，使用 Vinext/Nitro 构建。
- 正式部署：Vercel。
- 登录、数据库、RLS 和共享权限：Supabase。
- 未登录时的数据：浏览器 `localStorage`；登录后通过 `/api/workspace` 与 Supabase 同步。
- GitHub 仓库：`https://github.com/indigo-mxx/qiuzhao-tongxinglu`
- 默认主分支：`main`
- Supabase 项目 ID：`xhavwciesioqujdmkvob`
- 腾讯云 CloudBase 只做过尝试，不是当前正式数据库或部署方案。不要未经确认迁移到 CloudBase 或其他数据库。

## 3. 主要文件：需要修改哪里

- `app/recruitment-tracker.tsx`：主工作台。投递列表、筛选、公司岗位总览、岗位详情/面试弹窗、共享入口、统计入口和本地/云端数据交互大多在这里。
- `app/globals.css`：全局视觉、响应式布局、卡片、弹窗、标签、动效。新增 UI 尽量沿用现有绿色纸张风格和已有 class，不要随意引入另一套设计系统。
- `app/auth/page.tsx`：邮箱登录、邮箱注册、GitHub 登录按钮和错误提示。
- `app/account/page.tsx`：个人中心、邮箱绑定/密码设置等账户操作。
- `app/supabase-shell.tsx`：读取 Supabase 会话，并把登录状态交给主工作台。
- `app/api/workspace/route.ts`：需要登录的云端 API。负责读取/保存/删除投递记录、面试记录、创建/加入/退出/删除共享小组和邀请链接。
- `lib/supabase-browser.ts`：浏览器端 Supabase client。
- `lib/supabase-server.ts`：服务端根据 Access Token 创建 Supabase client。
- `app/layout.tsx`：页面元信息，并把运行时 Supabase 配置注入 `window.__SUPABASE_CONFIG__`。
- `supabase/migrations/001_initial.sql`：基础表、触发器、RLS 和共享函数。
- `supabase/migrations/002_company_metadata.sql`：行业标签和公司规模字段。
- `supabase/migrations/003_interview_end_time.sql`：面试结束时间字段。
- `README.md`：给用户看的安装、登录、数据库和部署说明。
- `ROADMAP.md`：后续功能规划。
- `tests/rendered-html.test.mjs`：基础构建后 HTML 检查。

## 4. 数据字段约定

### applications / Application

前端 camelCase 与数据库 snake_case 对应如下：

| 前端 | 数据库 | 说明 |
|---|---|---|
| `company` | `company` | 公司名称 |
| `position` | `position` | 岗位名称 |
| `base` | `base` | 工作地点，可为空 |
| `industryTags` | `industry_tags` | `text[]`，一个公司/岗位可有多个标签 |
| `companyScale` | `company_scale` | 公司规模或自定义描述 |
| `batch` | `batch` | 秋招、提前批、实习等 |
| `status` | `status` | 投递状态 |
| `appliedAt` | `applied_at` | 投递时间 |
| `channel` | `channel` | 投递平台，支持常见选项和自定义 |
| `link` | `link` | 职位链接 |
| `salary` | `salary` | 薪资信息 |
| `note` | `note` | 备注 |
| `visibility` | `visibility` | `private`、`progress`、`full` |
| `groupId` | `group_id` | 共享小组 |

### interviews / Interview

- `scheduledAt` / `scheduled_at`：面试开始时间，必填；
- `endedAt` / `ended_at`：面试结束时间，可为空，兼容旧数据；
- `round`、`format`、`interviewer`、`result`、`summary`、`nextSteps`：轮次、形式、面试官、结果、面经摘要、下一步。

新增字段必须同时更新：TypeScript 类型、表单默认值、本地读写、`app/api/workspace/route.ts` 的 GET 映射和 POST upsert、Supabase migration，以及 `001_initial.sql` 的全新安装结构。

## 5. Supabase 迁移规则

迁移按编号顺序执行：

1. `001_initial.sql`：全新项目的基础结构；
2. `002_company_metadata.sql`：行业标签和公司规模；
3. `003_interview_end_time.sql`：面试结束时间。

已有 Supabase 项目不能靠重新执行 `001_initial.sql` 修复。只执行尚未执行的 migration，优先使用 `alter table ... add column if not exists`，避免重复执行破坏数据。

如果网站出现 `/api/workspace` 的 `400 Bad Request`，优先检查 Supabase SQL Editor 是否执行了对应 migration。确认数据库字段后，再看 Network 响应体中的 `error` 文本；不要索要或转发完整请求头、Cookie 或 Bearer Token。

## 6. 环境变量和安全

正式环境需要配置：

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

这两个值在 Vercel 的 Production、Preview（如需要）环境配置，并在修改后重新部署。Publishable/anon key 可以出现在浏览器端，但绝不提交服务端密钥、Supabase service role key、Vercel token、用户密码、Cookie 或 Access Token。

`app/layout.tsx` 的运行时配置注入和 `lib/supabase-browser.ts` 的读取逻辑不要随意删除，否则 Vercel 运行时可能出现“未配置 Supabase 环境变量”。

## 7. 推荐开发流程

1. 阅读本文件和相关文件，先运行 `git status`，保留用户已有改动；禁止使用 `git reset --hard` 或覆盖未知文件。
2. 明确本次改动涉及的前端字段、API、数据库和权限范围。
3. 用 `apply_patch` 做小范围、可审查的修改，不要用脚本整文件重写。
4. 本地验证：
   - `git diff --check`
   - `npm run build`
   - `npm test`（涉及页面或构建时建议执行）
5. 涉及云端字段时，明确告诉用户需要在 Supabase SQL Editor 执行哪一个 migration；不要假装已经替用户操作控制台。
6. 涉及登录、共享或隐私时，检查未登录、本地模式、登录后、共享成员和非拥有者视图。
7. 完成后说明：改了什么、验证结果、是否需要用户执行 SQL、Vercel 是否会自动部署。

## 8. 产品交互约定

- 默认主视图使用紧凑的公司清单，一家公司一行；公司卡片墙、岗位明细表和进度看板都是可切换的显示方式，用户的选择保存在本机。点击公司名称、岗位数量或“查看详情”进入公司详情弹窗，再查看和编辑该公司的全部岗位。面试记录集中在岗位详情弹窗内管理，不再单独制造复杂的面试主栏目。
- 同一公司多个岗位必须全部显示，并支持岗位筛选。
- 筛选至少覆盖关键词、状态、批次、行业标签、公司规模、岗位和地点。
- `progress` 共享级别只展示进度所需信息；不要泄露职位链接、薪资和私人备注。
- `full` 才能展示完整共享字段；`private` 只对本人可见。
- 新增交互应同时考虑手机端、空状态、加载状态、保存失败和旧数据兼容。
- 视觉上保持简洁、明亮、具有动效但不过度；动效不能影响表单可操作性或可读性。

## 9. 部署和域名说明

代码推送到 `main` 后，Vercel 通常会自动部署。Vercel 项目名称、`.vercel.app` 域名和 GitHub 仓库名属于控制台配置，不是修改代码字符串就能完成的。当前实际访问域名可能随 Vercel 项目设置变化，部署前应以 Vercel 控制台显示的域名为准，不要凭记忆宣称域名已经切换。

如果 Vercel 显示 “You Need Access”，说明部署启用了 Vercel 访问保护，需要项目所属团队批准，或在 Vercel 项目设置中关闭保护；这与 Supabase 登录不是同一层问题。

## 10. 给下一位智能体的交接模板

开始新任务时，先补充以下信息再动手：

```text
任务目标：
影响范围：前端 / API / Supabase migration / Vercel 配置
已知问题或复现步骤：
用户是否允许修改数据库或部署：
完成标准：
验证方式：git diff --check、npm run build、npm test，以及必要的登录/共享手测
```

交接时必须说明：当前分支和提交、改动文件、是否新增 migration、用户还需要在 Supabase/Vercel 做什么、验证是否通过、已知未解决问题。

## 11. 不要做的事

- 不要提交 `.env.local`、密钥、Token、Cookie 或任何用户隐私；
- 不要未经确认迁移数据库、删除共享小组、清空投递记录或替换用户已有数据；
- 不要把腾讯云当作当前正式后端；
- 不要为了修复一个页面问题删除 RLS、共享权限或本地数据兼容逻辑；
- 不要只说“构建成功”就断言登录、OAuth、Supabase migration 或域名已经成功，外部控制台状态必须实际验证；
- 不要重复索取用户已经提供过的背景信息，先查看本文件和代码。
