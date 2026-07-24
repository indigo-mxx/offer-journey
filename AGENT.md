# 秋招同行录：智能体接手说明

本文档用于帮助后续智能体在本仓库中安全、连续地工作。请先完整阅读，再修改代码。

## 一、项目定位与当前技术方案

这是一个记录秋招、提前批、实习投递和面试进度的 Web 工作台，支持本地模式、登录后的云端同步，以及双人/好友共享。

当前正式方案：

- 前端与服务端：React + Vinext + Nitro
- 正式托管：Vercel
- 登录、数据库、共享权限：Supabase
- 本地数据：浏览器 `localStorage`
- 当前主分支：`main`
- GitHub 仓库：`https://github.com/indigo-mxx/qiuzhao-tongxinglu`
- Supabase 项目：`xhavwciesioqujdmkvob`

腾讯云 CloudBase 曾经用于尝试部署，但目前不是正式方案。`Dockerfile` 仍保留作备用，不要把 CloudBase 当作当前发布目标。

## 二、重要目录

- `app/recruitment-tracker.tsx`：主工作台、投递记录、筛选、公司岗位总览、面试弹窗、统计视图、共享入口。
- `app/globals.css`：全站视觉样式、响应式布局、动效。
- `app/auth/page.tsx`：邮箱登录/注册和 GitHub 登录页面。
- `app/account/page.tsx`：个人中心，可绑定邮箱、设置密码。
- `app/supabase-shell.tsx`：读取 Supabase 会话并把用户状态传给工作台。
- `app/api/workspace/route.ts`：需要登录的云端数据 API，负责投递、面试、共享小组等操作。
- `lib/supabase-browser.ts`：浏览器端 Supabase 客户端。
- `lib/supabase-server.ts`：服务端根据 Access Token 创建 Supabase 客户端。
- `app/layout.tsx`：页面元信息，以及运行时 Supabase 配置注入。
- `supabase/migrations/`：数据库迁移脚本，按编号顺序执行。
- `README.md`：给用户看的使用和部署说明。
- `ROADMAP.md`：后续产品规划。

## 三、数据结构与修改规则

### 投递记录

前端 `Application` 与数据库 `applications` 表主要字段包括：

- 公司、岗位、Base、批次、状态、投递时间
- 行业标签 `industryTags` / `industry_tags`：数组，一个公司或岗位可以有多个标签
- 公司规模 `companyScale` / `company_scale`
- 投递平台、岗位链接、薪资、备注
- `visibility`：`private`、`progress`、`full`
- 所属共享小组 `groupId` / `group_id`

不要把多个行业标签拼接到公司名称、备注或平台字段里；标签必须保持数组形式。

### 面试记录

前端 `Interview` 与数据库 `interviews` 表主要字段包括：

- `scheduledAt` / `scheduled_at`：开始时间，必填
- `endedAt` / `ended_at`：结束时间，可为空，兼容旧记录
- 轮次、形式、面试官、结果、面经摘要、下一步

新增字段时必须同时处理四处：

1. 前端 TypeScript 类型和表单默认值
2. 本地数据读取/归一化
3. `app/api/workspace/route.ts` 的 GET 映射和 POST upsert
4. 新的 Supabase migration，以及 `001_initial.sql` 的新建项目结构

## 四、Supabase 与环境变量

环境变量名称固定为：

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

不要读取、输出、提交或写入任何服务端密钥。Publishable/anon key 可以用于浏览器，但仍然不要把真实值写进 Git。

`app/layout.tsx` 会把运行时环境变量注入到 `window.__SUPABASE_CONFIG__`，`lib/supabase-browser.ts` 优先读取这个配置。这是为了兼容 Vercel 运行时环境变量；修改时不要删除这套运行时注入逻辑。

Vercel 项目需要在 Production 环境配置以上两个变量。修改环境变量后必须重新部署。

## 五、数据库迁移流程

当前迁移顺序：

1. `001_initial.sql`：基础表、触发器、RLS、共享小组函数
2. `002_company_metadata.sql`：行业标签和公司规模
3. `003_interview_end_time.sql`：面试结束时间

已有 Supabase 项目新增字段时，只执行尚未执行的迁移，不要重复改写历史数据。迁移脚本尽量使用 `add column if not exists`，保证重复执行不会破坏数据。

修改云端字段后，必须检查 API 的权限和隐私逻辑，尤其是好友查看 `progress` 时不能泄露渠道、链接、薪资和私人备注。

## 六、推荐的开发流程

1. 先查看 `git status`，保留用户已有改动，不要使用 `git reset --hard` 或覆盖未知文件。
2. 先阅读相关类型、API、迁移和样式，再设计一个完整的小改动。
3. 使用 `apply_patch` 修改文件，不要用脚本重写整个文件。
4. 本地验证：
   - `git diff --check`
   - Vercel 模式构建：设置 `VERCEL=1`、`NITRO_PRESET=vercel` 后运行 `vinext build`
   - 如涉及交互，至少检查登录/未登录、本地/云端、手机布局和旧数据兼容
5. 检查数据库迁移是否和 API、前端字段完全对应。
6. 提交后推送到 `main`，Vercel 会自动部署。
7. 最终说明改了什么、构建是否通过、是否需要用户执行 Supabase SQL 或 Vercel 设置。

## 七、当前产品交互约定

- 点击公司名称打开该公司的岗位总览；同一公司多个岗位必须全部显示。
- 投递筛选支持关键词、状态、批次、行业、规模、岗位、地点。
- 面试记录集中在岗位弹窗中管理，也可以从面试区域新增。
- 统计视图是 `数据分析` 标签，不要把统计逻辑散落到多个组件中。
- 个人中心入口是 `/account`，显示名称为“个人中心”。
- 共享视图必须保留逐条隐私控制和邀请链接能力。
- 新增交互尽量使用已有的绿色纸张风格，避免引入不一致的第三方 UI 组件。

## 八、品牌与域名

当前品牌文案使用 `MXX · 秋招同行录`，目标 Vercel 项目名为 `mxx-qiuzhao-together`。

Vercel 项目名称和 `.vercel.app` 域名属于控制台配置，不是代码文件能够完全修改的。需要在 Vercel Project Settings → General 中改名；如果旧链接不能继续访问，还要在 Domains 中移除旧域名或停用旧项目。不要在代码里假装域名已经切换成功。

## 九、不要做的事情

- 不要提交 `.env.local`、Supabase 密钥、Vercel Token 或任何聊天中出现的敏感凭证。
- 不要把 Supabase 数据库迁移到腾讯云/其他数据库，除非用户明确确认并单独制定迁移方案。
- 不要为了修一个页面问题删除现有共享小组、投递记录或数据库迁移。
- 不要把 `progress` 共享级别误改成完整共享。
- 不要删除旧字段或强制要求旧本地备份必须包含新字段。
- 不要仅因为构建成功就声称 Vercel 域名、Supabase OAuth 或数据库迁移已经完成；外部控制台状态需要实际验证。

## 十、交付前检查清单

- [ ] `git diff --check` 通过
- [ ] Vercel 模式构建通过
- [ ] 未登录本地记录可新增、编辑、删除、导入、导出
- [ ] 登录后云端记录和面试记录可同步
- [ ] 旧记录没有新字段时不会崩溃
- [ ] 共享记录仍遵守隐私级别
- [ ] 新数据库字段有对应 migration
- [ ] README 已说明需要用户执行的外部配置
- [ ] Git 工作区干净，提交和推送状态明确
