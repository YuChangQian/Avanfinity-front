# Avanfinity Frontend

Avanfinity 独立前端仓库，React + TypeScript + Vite。前端源码位于 `src/`。

## 本地开发

使用 Node.js 24（与 Dockerfile 一致）及 npm：

```sh
npm ci
npm run dev
```

默认访问 http://localhost:5173。`/api` 默认代理到本机 `http://127.0.0.1:8080`，联调时使用开发或测试后端：

```sh
VITE_API_TARGET=http://127.0.0.1:8080 npm run dev
```

不要把服务端密钥写入前端变量或提交到仓库。`VITE_*` 变量可被浏览器读取。需要实际登录、下单等功能时，需提供兼容后端；本仓库不包含后端服务或数据库。

## 构建与验证

```sh
npm run build
npm run check:cdk-v2
npm run test:e2e:frontend
npm run test:cdk-v2
```

浏览器测试需要安装 Chrome（测试配置使用 `channel: chrome`）。前端 mock 测试无需生产数据。原 `npm run test:e2e` 和 `playwright.config.ts` 是完整项目集成测试，依赖相邻 `../backend` 与隔离测试数据库，不能仅凭本仓库运行。

可选构建变量 `PUBLIC_ORIGIN` 指定公开站点 origin，用于 SEO 资源。Docker 构建上下文为本仓库根目录；Nginx 的 API 上游还需要在部署环境提供。本仓库推送不会自动更新现有生产站点。

## API 契约

`openapi/` 保存此次导出对应的 API 文档。修改契约后运行：

```sh
npm run generate:cdk-v2
npm run check:cdk-v2
```

不要手工修改 `src/generated/cdk-v2.ts`。与后端协作时需同步更新契约。

## 导出基线与协作

- 导出日期：2026-10-28（Asia/Shanghai）。
- 来源：主项目当前本地 `frontend/`，基线提交 `763bf6e15ff5c09f4210f4c96d94a89fa37e340a`，包含当前前端未提交修改。
- **包含尚未上线的 GPT CDK 结账地区选择（V1/V2），需要主项目中配套的后端更新后才能完整生效。此导出不等同于线上快照。**
- 本仓库用于同事前端开发。完成修改后，将经过评审的前端变更合回主项目 `frontend/`，再按主项目流程发布，保留一个生产主线；不要用旧整包覆盖主项目。
- 独立导出的适配仅包括 API 契约路径、开发目录访问范围、忽略规则及本文档。未携带生产配置、密钥、数据库、依赖目录或构建产物。
