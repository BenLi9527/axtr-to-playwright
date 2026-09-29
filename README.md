# AXTR → Playwright 转换器

Chrome / Edge 浏览器扩展（Manifest V3），将 Dynamics 365 Finance & Operations
Task Recorder 生成的 `.axtr` 录制文件转换为 Playwright 测试脚本（`.spec.ts`）。

纯前端实现：解压 / 解析 / 代码生成全部在浏览器扩展内完成，不依赖任何后端服务。

## 功能

- 通过插件弹出页面（popup）上传 `.axtr` 文件（本质是 ZIP 压缩包）。
- 使用 [JSZip](https://stuk.github.io/jszip/)（打包为扩展本地依赖，不走 CDN）在浏览器端解压，读取其中的 `Recording.xml`。
- 宽容解析 `Recording.xml` 中的步骤序列（Task Recorder 没有公开官方 XSD，字段名/结构在不同版本间有差异，解析器对缺失字段做兜底，不会因个别节点异常而整体失败）。
- 根据步骤的 `ActionType` 生成对应 Playwright 代码：
  - `Click` → `page.getByRole(...)` / `page.getByText(...)`
  - `SetValue` / `SetText` → `page.getByLabel(...).fill(...)`
  - `Select` → `page.getByLabel(...).selectOption(...)`
  - `Navigate` / 打开表单类操作 → 仅生成说明性注释（不编造真实 URL）
  - 无法确定选择器的步骤 → 生成 `// TODO:` 注释，并保留原始 `Form`/`ControlType`/`Path`/`DataAreaId` 等信息供人工核对
- 每个步骤前附带来自 `DisplayText` 的注释，说明这一步做了什么。
- 生成结果在只读文本框中展示，支持“复制到剪贴板”和“下载 `.spec.ts` 文件”。
- 出错（找不到 `Recording.xml`、XML 不合法等）时会在页面上给出清晰的错误提示，不会静默失败。

## 技术栈

- TypeScript
- [Vite](https://vitejs.dev/) + [`@crxjs/vite-plugin`](https://crxjs.dev/vite-plugin)（Manifest V3 构建）
- [JSZip](https://stuk.github.io/jszip/)（浏览器端解压 ZIP）
- 浏览器原生 `DOMParser`（解析 XML，测试环境下由 `jsdom` 提供同名 API）
- [Vitest](https://vitest.dev/)（单元测试）

## 项目结构

```
manifest.json                  # MV3 清单（构建时由 @crxjs/vite-plugin 处理）
vite.config.ts                 # Vite 构建配置
vitest.config.ts               # 测试配置（jsdom 环境）
scripts/gen-icons.mjs          # 生成占位图标的小脚本（无外部依赖）
public/icons/                  # 扩展图标
src/
  lib/
    types.ts                   # Recording.xml 解析后的数据结构定义
    parseRecording.ts          # 宽容解析 Recording.xml -> ParsedRecording
    extractAxtr.ts             # 用 JSZip 从 .axtr 中提取 Recording.xml
    generatePlaywright.ts      # ParsedRecording -> Playwright TS 脚本字符串
  popup/
    index.html                # 插件弹出页面
    popup.css
    main.ts                    # 页面交互逻辑（文件选择、转换、复制/下载）
  test/
    recording.test.ts          # 针对解析函数与代码生成函数的单元测试
```

## 安装依赖并构建

```powershell
npm install
npm run build
```

构建产物输出到 `dist/`，可直接作为“已解压的扩展程序”加载。

开发模式（带 HMR，仍需重新加载扩展以应用 manifest/background 变化）：

```powershell
npm run dev
```

## 在 Chrome / Edge 中加载测试

1. 执行 `npm run build`，确认生成了 `dist/` 目录。
2. 打开浏览器扩展管理页面：
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. 打开右上角的“开发者模式”开关。
4. 点击“加载已解压的扩展程序”（Load unpacked），选择本项目的 `dist` 目录。
5. 在工具栏的扩展图标中点击本插件，打开弹出页面。
6. 点击文件选择器，选择一个 `.axtr` 文件，等待解析完成后即可在文本框中看到生成的 Playwright 脚本，可点击按钮复制或下载 `.spec.ts` 文件。

## 运行单元测试

```powershell
npm run test
```

测试针对 `parseRecordingXml`（解析）与 `generatePlaywrightScript`（代码生成）两个核心函数，
使用手写的示例 `Recording.xml` 字符串作为输入，覆盖：属性/子元素两种取值方式、
缺失控件名称时的 TODO 兜底、未知 `ActionType` 的兜底、非法/空 XML 的错误提示、
以及 Navigate 步骤绝不编造 URL 等关键行为。

## 已知局限性

- Task Recorder 没有公开发布的官方 `Recording.xml` XSD，不同 D365 版本/控件类型的字段
  命名和结构可能存在差异。本工具的解析器为宽容式实现（属性名尝试多种拼写、缺失时
  尝试同名子元素、单个节点异常不影响整体解析），但仍可能遗漏一些非常规控件的信息。
- 自定义控件、第三方扩展控件、或字段信息严重缺失的步骤，可能只能生成 `// TODO:` 占位
  注释，无法自动产出可运行的选择器代码，需要人工对照原始录制截图/描述进行补充。
- `Navigate` / 打开表单、工作区类的步骤，由于录制文件中不包含真实浏览器 URL，本工具
  不会编造 `page.goto(...)`，只会生成说明性注释，需要人工补充真实的导航逻辑。
- 生成的选择器优先使用控件的 `Name` / `AutomationName`；如果这些属性与页面运行时实际
  的可访问名称（accessible name）不完全一致，仍需要人工调整为更贴合实际 DOM 的定位方式
  （例如结合 `page.locator()` 与 CSS/测试属性选择器）。
- 本工具生成的是"脚本骨架"，用于加速手工编写 Playwright 用例，而不是保证开箱即用、
  可直接在 CI 中稳定运行的最终脚本。
