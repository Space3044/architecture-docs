# architecture-docs

architecture-docs 是一个与项目框架无关的静态文档聚合 CLI。它读取项目自己的 docs/ 和 manifest，生成一个可以静态部署的文档入口，并检查路径、状态、分类和可选的源码漂移。

它不负责绘制单张图，也不复制 Archify。Archify、Mermaid 或其他绘图工具仍然负责生成单张图的源文件和 HTML；本工具只登记、聚合和校验这些文件。

## 快速开始

在项目根目录执行：

~~~text
npx architecture-docs init
npx architecture-docs build
npx architecture-docs check
~~~

init 不会覆盖已有文件。生成后的 docs/index.html 是静态文件，可以由任意静态服务器部署。

## 配置

默认配置文件是 architecture-docs.config.json：

~~~json
{
  "schema_version": 1,
  "docsRoot": "docs",
  "manifest": "docs/catalog/manifest.json",
  "viewer": {
    "template": "default",
    "output": "docs/index.html",
    "readme": "docs/README.md"
  },
  "discovery": {
    "include": ["**/*.md", "**/*.html", "**/*.json"],
    "exclude": ["README.md", "index.html", "catalog/**"]
  },
  "providers": [],
  "drift": { "enabled": true }
}
~~~

所有配置路径都相对于项目根目录。manifest 中的 path、source 和 artifact 都相对于 docsRoot，工具拒绝绝对路径和 .. 逃逸。

## Manifest

manifest 是正式入口。每个条目至少有 id、status 和一个 path，或者同时声明 source 与 artifact：

~~~json
{
  "schema_version": 1,
  "project": {
    "name": "Example Project",
    "description": "Project documentation portal"
  },
  "groups": [
    {
      "id": "overview",
      "label": "Architecture",
      "question": "How is the system assembled?",
      "entry_ids": ["overview"]
    }
  ],
  "entries": [
    {
      "id": "overview",
      "title": "Documentation overview",
      "question": "How is the system assembled?",
      "type": "architecture",
      "status": "active",
      "source": "overview.json",
      "artifact": "overview.html",
      "tags": ["boundary"]
    }
  ]
}
~~~

兼容读取旧的 `diagrams` + `view_taxonomy.diagram_ids` 结构；新项目建议使用通用的 `entries` + `groups.entry_ids` 命名。

可见状态是 active 和 needs-refresh；planned/draft 会进入维护队列，其他状态保留在 manifest 中但不进入当前查看器。

## 命令

~~~text
architecture-docs init [--root <path>]
architecture-docs discover [--root <path>] [--json]
architecture-docs build [--root <path>] [--config <path>] [--check]
architecture-docs check [--root <path>] [--json] [--strict-drift]
architecture-docs doctor [--root <path>]
~~~

discover 只提示 include 范围内未登记的文件，不会修改 manifest，也不会自动把文件加入门户。check 默认把 drift 和 provider 问题作为诊断；使用 --strict-drift 或配置 provider 的 strict 才会阻塞。

## Provider contract

项目可以在配置中加入自己的源码 inventory 或 drift provider：

~~~json
{
  "providers": [
    {
      "name": "source-inventory",
      "module": "scripts/inventory-provider.mjs",
      "strict": false
    }
  ]
}
~~~

Provider 模块导出 run(context, options) 或默认函数，并返回：

~~~json
{
  "schema_version": 1,
  "provider": "source-inventory",
  "objects": [],
  "diagnostics": []
}
~~~

核心不会解析框架私有格式，也不会根据函数名猜测业务关系。

## 从项目脚本迁移

如果项目已经有自己的 docs 查看器或目录脚本，可以按以下顺序迁移：

1. 在项目根目录运行 `npx architecture-docs init`，确认生成的配置、manifest 和 `docs/README.md` 不会覆盖已有文件。
2. 将现有文档入口整理为 manifest 的 `entries` 和 `groups`；旧的 `diagrams` 与 `view_taxonomy` 结构也可以先保持不变，由兼容读取处理。
3. 将原有 viewer 生成切换为 `architecture-docs build`，将 CI 校验切换为 `architecture-docs build --check` 和 `architecture-docs check`。
4. 继续使用 Archify、Mermaid 或其他绘图工具生成单张图；只把图的源文件和产物路径登记到 manifest。
5. 如果项目需要源码 inventory 或 drift 检查，再通过 provider 配置接入；provider 失败是否阻塞由项目自己的 strict 策略决定。

迁移不要求改变项目源码目录，也不要求把项目专用扫描器、业务分类或图谱内容提交到本 npm 包。

## 发布边界

npm 包只包含 CLI、通用源码、模板、schema、fixture 和本 README。项目源码、任务目录、.git、凭据、业务图谱和 reference 文档由使用它的项目自行维护，不会进入发布包。

## License

MIT License. See [LICENSE](./LICENSE).
