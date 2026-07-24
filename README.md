# 秋招同行录

一个面向秋招、提前批和实习投递的个人进度工作台。

## 当前版本

- 记录公司、岗位、Base 城市、招聘批次和投递时间
- 为公司添加多个行业标签（半导体、具身智能、智能驾驶、软件、游戏、汽车等），也支持自定义标签
- 记录公司规模（常用人数区间或自定义），并按行业、规模筛选投递记录
- 记录投递渠道、岗位链接、薪资、备注与下一步
- 随时新增、编辑、删除，直接在清单里更新流程状态
- 按关键词、状态和批次筛选
- 自动统计累计投递、进行中、面试阶段和 Offer
- 数据自动保存在当前浏览器
- 支持 JSON 备份的导入与导出
- 支持 ChatGPT 登录后的云端同步与跨设备使用
- 支持创建/加入共享小组、邀请码和好友进度视图
- 每条投递可设置为仅自己、仅共享进度或完整共享
- 登录后可一键迁移原有本地记录到云端

第一次打开会显示三条演示记录，可以直接编辑或删除。未登录时仍可在本地使用；登录后会自动切换至云端数据。

## 数据库升级

已有 Supabase 项目升级时，请在 Supabase Dashboard 的 SQL Editor 中执行 `supabase/migrations/002_company_metadata.sql`，一次即可为已有投递记录增加行业标签和公司规模字段。新建项目按顺序执行 `supabase/migrations/001_initial.sql` 和 `002_company_metadata.sql`。

腾讯云 CloudBase 部署使用仓库 `main` 分支，监听端口为 `3000`；代码推送后可在 CloudBase 的构建记录中点击“重新部署”。

## 腾讯云登录配置

CloudBase 的运行环境变量中需要配置以下两项（不是 Dockerfile，也不要提交 `.env.local`）：

- `NEXT_PUBLIC_SUPABASE_URL`：`https://xhavwciesioqujdmkvob.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`：Supabase 项目设置 → API 中的 Publishable key（旧界面叫 anon key）

应用会在页面运行时读取这两个配置，因此只需在 CloudBase 运行环境变量中设置并重新部署，邮箱和 GitHub 登录都会恢复。

## 本地运行

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

## 产品路线

详细规划见 [ROADMAP.md](./ROADMAP.md)。
