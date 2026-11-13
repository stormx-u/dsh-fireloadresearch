# dsh-furniture-fireload · 家具火灾荷载工作台

把两个本地工具整合成 **一个 DSH 插件**：

| 原工具 | 在本插件里的角色 |
| --- | --- |
| Fireprediction 的两个训练模型（重量融合 + 体积比例） | 由外包围盒尺寸 + 家具图预测 **家具重量**、**外壳包裹体积**（含空腔）与包围盒占空比（**已内置**在插件 `py/vendor/fireprediction`，用 numpy + onnxruntime 直接推理；外部 `D:\Fireprediction` 目录只作为可选覆盖） |
| `...\outputs\furniture-material-tool`（Python/Tk 工具） | 本机 YOLO 材质分割、可见材质/金属复核、**材料大类 → 具体材质细化**、质量/密度/体积约束下的**材质占比**、**单件家具火灾荷载**（**已内置**在插件 `py/vendor/material`） |

插件在 Web 端提供一个原生面板（`sidebar.panellist` 入口 + `main` 全幅工作台），把附图里的流程直接做成节点式布局：

```
图片 + 尺寸 ──► Fireprediction 重量 / 包裹体积 ──► 物品平均密度
                        │                                   │
                        └────────► 家具材质组合 ◄── 视觉模型（材质分类）
                                        │
                                  材质占比 ──► 家具热值 ──► 单个家具火灾荷载
                                        ▲
                                  判定模型（原 JEV / 可切换 DeepSeek）
```

## 安装与启用

```powershell
# 1) 在 DSH 里安装（link 指向上面的源码目录）
dsh plugin --profile web add link:D:\dsh workplace\dsh-furniture-fireload

# 2) 改完源码后必须重装：generation 是内容拷贝，不会热跟随源码
dsh plugin --profile web remove dsh-furniture-fireload
dsh plugin --profile web add link:D:\dsh workplace\dsh-furniture-fireload
```

安装后刷新 Web GUI，左侧边栏出现「火灾荷载」入口。

### 从 GitHub 克隆安装

```powershell
# 仓库使用 Git LFS 存放模型权重（合计约 427 MB），先确认装了 git-lfs
git lfs install
git clone https://github.com/stormx-u/dsh-fireloadresearch.git D:\dsh-fireloadresearch

dsh plugin --profile web add link:D:\dsh-fireloadresearch
```

克隆后目录结构即为插件本体（`package.json` 在仓库根）。修改源码后同样需要 remove → add 重装
（generation 是内容拷贝，不会热跟随源码）。

> 体积提示：`py/vendor/material`（约 148 MB，YOLO 材质/金属/定位权重）与
> `py/vendor/fireprediction`（约 278 MB，重量融合 + 体积模型）都随仓库分发；
> 每次 `install` 会把整份内容复制进新的 generation，确认新版本可用后可清理
> `profiles\.generations\live\` 下的旧目录。

### 密钥放在哪里（不会进仓库）

插件**不会**把任何密钥写进自己的目录，也不会写进导出的结果或 Excel：

| 密钥 | 存放位置 | 说明 |
| --- | --- | --- |
| 判定/复核用的 OpenRouter 密钥、自定义模型密钥、DeepSeek API 直连密钥 | `%LOCALAPPDATA%\dsh-furniture-fireload\settings.json` | 只在本机；面板「0 自定义模型」与各步骤下拉里填的就是这套配置 |
| 批量任务的请求文件 `batches\<id>\request.json` | `%LOCALAPPDATA%\dsh-furniture-fireload\batches\` | 写盘前会把 `models.*.apiKey` 清空，只留地址与模型名 |
| 材料分析模块的 DPAPI 文件 `.runtime\openrouter-key.bin` | 运行时目录（默认 `%LOCALAPPDATA%` 下） | 仅在未填密钥时作为兜底读取；`.runtime/` 已被 `.gitignore` 排除 |

仓库侧还有两道防线：

```bash
# 1) 提交前自动扫描（.gitignore 之外的第二道保险）
git config core.hooksPath .githooks      # 启用 .githooks/pre-commit
node scripts/check_secrets.mjs           # 也可以手动跑，命中会打印文件:行号并退出 1

# 2) 二进制/运行时目录整体忽略
cat .gitignore   # .runtime/ **/.runtime/ *.bin settings.json *.log 等
```

扫描规则覆盖：`sk-or-v1-`（OpenRouter）、`sk-`（DeepSeek/OpenAI 形态）、
`Authorization: Bearer` 令牌、`OPENROUTER_API_KEY=` 之类的赋值、以及
`apiKey: "<16 位以上字面量>"`。命中时不打印完整密钥（只显示前 8 位）。

### 许可与来源

* 插件代码：Apache-2.0（见 `LICENSE`）。
* 材质分割权重来自 Ultralytics YOLO 训练结果，遵循 **AGPL-3.0**（见
  `py/vendor/material/ULTRALYTICS-LICENSE.txt`）；在网络上提供服务时请自行评估 AGPL 义务。
* Fireprediction 系列模型（`weight_fusion_v3` / `volume_convnext_general` /
  `cabinet_head`）由本仓库维护者训练并提供；`py/vendor/fireprediction/licenses/`
  收录了训练与导出阶段所用依赖的许可文本。
* 材料物性表与频次先验（`py/vendor/material/data/`）来源见原工具的《来源说明》；
  热值为**低位热值（LHV，净热值）**。

## Fireprediction 内置（1.1.0 起）

原工具 B（`D:\Fireprediction`，约 460 MB 的 PyInstaller 包）现在不再需要：

* 重量：两个 HistGradientBoostingRegressor（`fusion.joblib`）在构建期被转成 `py/vendor/fireprediction/models/weight_fusion.npz`（12,237,412 节点，86.6 MB），运行时用纯 numpy 逐树前向；分类特征（家具类别）的 bitset 与分箱阈值都按 sklearn 的规则复刻。
* 体积：`image_encoder.onnx`（192×192 图像嵌入）、`general.onnx`（224×224 → 占空比 + 1536 维特征）、`cabinet_head.onnx` + `cabinet_router.npz`（柜子实验版路由），用 onnxruntime CPU 会话运行，预处理与 CLI 完全一致（RGB、EXIF 纠正、白底合成、ImageOps.contain、ImageNet 归一化）。
* 校验：`scripts/test_builtin_fireprediction.py` 用 8 张示例图逐项比对内置引擎与 `FirepredictionCLI.exe` 的 `mass.estimated_kg` / `image_component_kg` / `volume.ratio` / `estimated_m3` / `bbox_m3` / `sha256`，当前最大相对误差 7.9e-7（onnxruntime float32 跨进程噪声），可视为一致。
* 体积代价：`py/vendor` 合计约 426 MB（材质 148 MB + Fireprediction 278 MB）。每次 `install_bundle` 会把它复制进新的 generation，旧 generation 可在确认新版本正常后清理。
* 外部 CLI 仍被支持：设置里填了有效目录、或旧默认目录存在时，可在请求里用 `physicalEngine: "external"` 走外部 CLI；默认 `"builtin"`。

## 内置化：不再依赖外部工具目录（1.0.0 起）

| 组件 | 变化 | 说明 |
| --- | --- | --- |
| 材质分析模块（原「工具A」） | **已内置** | `py/vendor/material/`（约 148 MB，主要是三个 YOLO 模型），与外部工具目录同构放置，模块内的相对路径逻辑无需改动；`py/bridge.py` 的 `resolve_material_dir()` 依次尝试「设置里的目录 → 内置副本 → 旧默认路径」 |
| Fireprediction（原「工具B」） | **已内置（1.1.0 起）** | `py/vendor/fireprediction/`：`weight_fusion.npz`（把原 `fusion.joblib` 的两个 HistGBR 转成纯 numpy 前向，12,237,412 个节点，86.6 MB）+ `image_encoder.onnx` / `general.onnx` / `cabinet_head.onnx` / `cabinet_router.npz`，合计约 278 MB。推理结果与 `FirepredictionCLI.exe` 逐项对齐（相对误差 < 1e-6，属 onnxruntime float32 噪声）。装了外部 `FirepredictionCLI.exe` 时仍可用它覆盖内置引擎 |

* 单件日志会出现「材质模块 <目录>｜Fireprediction 内置模型/未使用」。
* 面板「高级设置」用「材质模块 ✓ 内置」「Fireprediction ✓ 内置训练模型 / ✓ 已找到（外部目录）/ ✗ 未检测到」表达。
* 想强制验证回退路径：设置环境变量 `FURNITURE_FIRELOAD_NO_FIREPREDICTION=1` 再启动（开发自检用，会把内置引擎与外部 CLI 一起禁用）。
* 代价：插件包因此约 149 MB，每次 `install` 会把这份内容复制进新 generation（`profiles\.generations\live\`），旧 generation 可在确认新版本可用后清理。

## 运行前需要准备什么

* **Python（含 torch/ultralytics）**：默认按顺序探测
  1. 设置里的「Python 路径」
  2. 环境变量 `FURNITURE_FIRELOAD_PYTHON`
  3. `...\work\venv\Scripts\python.exe`（工具A 自带 venv，已验证 torch 2.11 / ultralytics 8.4）
  4. `...\work\python\cpython-3.12.16-...\python.exe`
  5. DSH 自带 office Python
* **材质分析模块：已内置**（`py/vendor/material`，含 YOLO 模型 `material-four.pt` / `metal-five.pt` / `furniture-coco.pt` 与物性表、频次先验）。面板「高级设置」里显示「材质模块 ✓ 内置」；只有在设置里显式填了一个**确实存在**的目录时才会改用外部副本。
* **Fireprediction：已内置**（`py/vendor/fireprediction`，约 278 MB）。默认用插件内的 numpy/onnxruntime 引擎推理重量与包裹体积，物理量来源显示「内置训练模型」；外部 `FirepredictionCLI.exe` 存在时可作为覆盖。只有内置模型文件缺失且没有外部 CLI 时，才会**自动**改用视觉模型估计质量与体积（也可手工填），批量模式逐件回退，热值照常计算。
* **判定模型（三选一）**
  | 选项 | 说明 |
  | --- | --- |
  | `deepseek` + 通道「宿主内置模型」 | 走 DSH 的 `llm` 服务，**不需要任何密钥**，模型下拉来自当前会话的模型目录（默认取会话默认模型，可切 deepseek 系列） |
  | `deepseek` + 通道「API 直连」 | 直连 `https://api.deepseek.com`，需填密钥（也可用环境变量 `DEEPSEEK_API_KEY`） |
  | `jev` / `free-vision` | 保留原工具行为：OpenRouter Decisions API（`perplexity/pplx-decider-v1.2`）或免费视觉模型；需 OpenRouter 密钥 |
* **视觉复核**：默认「自动」——只有当存在 OpenRouter 密钥时才联网复核可见材质；否则只用本机 YOLO 分割结果，并把候选材质标记为未确认（结果会降级为条件估计，不会静默失败）。

## 判定模型的切换点（按原工具的真实抽象）

原工具的客户端接口是：

```python
client.decide(state_text, images, questions) -> {question_id: {"choice": id, "probabilities": {id: p}}}
```

插件在 `py/bridge.py` 里实现同一接口的多种客户端：`StubDecider`（离线自检）、`HostLlmClient`
（经 stdout/stdin 与宿主模型往返）、`OpenAICompatClient`（DeepSeek API 直连）、
`DecisionClient` / `FreeVisionClient`（复用原工具，OpenRouter）以及 `RouterClient`
把「视觉复核问题」和「构造判定问题」分派到不同客户端。

* 「构造判定」问题 id = `construction`，候选是 `B01..Bnn + unknown` —— 这就是附图里的 **JEV 类大模型 判定** 节点。
* 「视觉复核」问题 id = `furniture_type` / `visible_metal` / `candidate_NN` —— 需要图像，DeepSeek（文本）只做降级处理，不影响本机分割。

因此把 JEV 换成 DeepSeek 只需换客户端，**不改动任何估计逻辑**。

### 图像（视觉）通道

DeepSeek 本身是文本模型，但当前会话里通常还有一条 **modlens 视觉桥**路线
（提供方 `deepseek-modlens`，模型标签形如 `DeepSeek-V4-Pro (modlens vision)`）：它声明
`image` 输入模态，把图片块转成文字证据再交给 DeepSeek 作答。

插件据此实现了可切换的图像通道：

1. `py/bridge.py` 的 `HostLlmClient` 把构造判定用的图片（preview / crop，去重、最长边 ≤1536、
   JPEG q85）导出到 `jobs/<jobId>/decision-images/`，并在 `decision` 消息里带上文件列表。
2. `lib/index.js` 的中继会读取文件，用宿主 `attachments.saveImage()` 换成附件引用，再以
   `[{type:"text"},{type:"image", attachment}]` 形式交给 `llm.stream`。
3. 模型选择：所选模型在 `/models` 里声明了 `image` 模态就直接附带；否则自动改用视觉通道
   （优先 `modlens` 提供方）；如果连视觉通道都没有，就退回纯文本并提示。整条链路失败时也会
   自动重试一次纯文本，不会中断任务。
4. 面板「3 判定模型 → 图像输入」可在 **自动 / 关闭** 之间切换（默认自动）。

## 自定义模型库：把多个模型直接列进选项（0.9.0 起）

面板左侧「0 自定义模型」是一个模型库：点「添加一个模型」，填 **名称 / 模型名 / API 地址 / API 密钥**，
再按需勾选「支持图片输入（视觉模型）」，保存到本机插件数据目录（`settings.customModels`）。

保存后，凡是「可选模型」的步骤都会把它们直接列成选项，并且同一个任务里的不同步骤可以挑不同模型：

| 步骤 | 选项 |
| --- | --- |
| 3 判定模型（材质组合判定） | 宿主模型（自动/指定）、**任意一个自定义模型**、免费视觉模型、JEV、不判定 |
| 4 LLM 直接估计 → 估计用模型 | 与判定模型一致、**任意一个自定义模型** |
| 5 材质区域识别 | 本机 YOLO 分割、宿主模型直接判定、**任意一个自定义模型（需要能看图）** |
| 6 视觉复核 | 自动（OpenRouter 免费视觉）、JEV、**任意一个自定义模型**、不联网 |
| 批量分析 | 「材质判定模型 / 质量体积估计模型」都是与单件页相同的单选下拉：宿主模型，或「0 自定义模型」里保存的模型（可各自不同） |

四个步骤（3/4/5/6）都是**同一个下拉选法**：下拉里直接列「宿主模型 / 自定义模型 / 路由类选项」，
选中自定义模型就用它的地址、模型名与密钥，不再需要额外填通道与模型名（0.9.2 起统一）。

实现要点：

* 单件页的判定模型走 `request.decider.custom*`（服务端从库里解析地址/模型/密钥，**只走 stdin，不落盘**）；
* 区域识别 / LLM 直接估计走 `segmentation.customModelId` / `llmEstimate.customModelId`，
  宿主解析后按需调用外部 OpenAI 兼容接口（`lib/index.js` 的 `askSegmentationViaApi` / `estimateViaApi`）；
* 地址会自动补 `/chat/completions`；接口不支持 `response_format` 时会自动去掉该字段重试；
* 失败只回退该环节（区域识别回退本机 YOLO，估计回退 Fireprediction/手工值），任务不中断；
* 自定义模型最多 20 条，没有填模型名的行会被忽略。

## 材质区域识别：本机 YOLO 或大模型直接判定（0.7.0 起）

面板「5 材质区域识别」有两种模式（`segmentation.engine`）：

| 模式 | 谁找目标框 | 谁给可见材质面积占比 | 是否逐区域复核 |
| --- | --- | --- | --- |
| `yolo`（默认） | 本机 YOLO（无目标框时整张图片当家具） | 本机 YOLO 分割出的可见材质区域 | 可开「6 视觉复核」让模型复核这些区域 |
| `llm` | 视觉大模型（归一化 0–1 包围框） | 视觉大模型（只允许织物/木材/塑料/玻璃/金属五类） | 不做（没有本机区域可复核） |

`llm` 模式的执行顺序（见 `lib/index.js` 的 `runLlmSegmentation` / `py/bridge.py` 的 `_llm_result_class`）：

1. 宿主把原图交给视觉通道（模型不支持图片时自动换 `modlens` 视觉桥），要求返回
   `{"target":{...},"materials":[{"broad":"wood","share":0.48}, …],"furniture_type":"","confidence":0.6,"notes":""}`。
2. 解析出的目标框换成 `analysis.Target(mode="llm")`，用 `analysis.prepare_crop` 切图；
   材质面积占比写进 `Result` 替身的 `statistics()`，`parts` 为空。
3. 跳过本机分割与逐区域复核，直接进 `composition.infer()`（构造判定 → 细化 → 物理约束 → 热值），
   所以质量占比、热值、火灾荷载等下游口径与 YOLO 模式完全一致。
4. 失败（无模型、模型不返回可用 JSON）只 warn 并 **自动回退本机 YOLO**，任务不中断；面板会说明回退原因。

注意：`llm` 模式给的只是**照片可见面积占比**，隐藏结构/内部填充仍由构造先验与密度约束补全。
批量也支持这个选项（「批量分析 → 材质区域识别」）：每件单独向视觉模型请求一次（目标框 + 可见
材质面积占比），比 YOLO 慢一条视觉请求/件；某一件请求失败时只让那一件回退本机 YOLO，并在
结果表「区域识别」列与备注里写明原因。批量的「质量体积来源」也可以换成视觉大模型估计（0.8.0 起，
见「批量模式」一节），两个环节的模型可以分别指定。

## 质量占比怎么读（为什么合计必须是 100%）

面板「7 家具中材质的占比」里的 **质量占比 = 该材质质量 ÷ 家具总质量**，不是像素占比、也不是频次占比。
物性口径上它必然闭合：

* 大类质量占比（面板「家具材质组合」的条形图，或「分层细化」表的「大类质量占比」列）合计 = **100%**；
* 每个大类内部的频次 / 后验只决定「这一份质量在大类内部怎么分」，因此**全部具体材质**的质量占比合计仍 = **100%**；
* 面板表格底部有 **合计** 行（材质项数 + 质量占比 + 质量 kg），可直接对照家具总质量。

两种容易误读的情况（0.4.2 起面板会显式说明）：

1. **分层细化表**每个大类只列「最可能的一种具体材质」，所以那张表的「该材质占全家具」列合计**不是** 100%——
   要看合计请用「大类质量占比」列或上面的材质总表。
2. **没有质量/体积输入**时（未勾选 Fireprediction 且未填手工值），组合只能给到 `materials_only`：
   面板只列材质候选、不产生质量占比，热值与火灾荷载都记为 `unavailable`。

3. **长表格默认折叠**（0.4.3 起）：材质表只显示质量占比最大的 6 项、热值表 5 项、分层细化表 4 个大类，
   底部 **合计行始终可见**；点「展开全部 N 项」可看全量，再点「收起」折叠回去。

## 热值口径：用的是**低位热值（LHV / 净热值）**（0.6.2 起面板与批量表格都标注）

数据表 `data/材料分类与物性表.csv` 有一列 **`热值口径`**，112 种材质全部写的是 **`低位热值(LHV, net)`**：

* `catalog.py:151` 原样把这一列读成 `heat_basis`；`fire_load.py` 的 `_basis()` 再归类成 `LHV` / `HHV` /
  `unspecified_or_mixed`，汇总进 `heat_bases` 与 `mixed_heat_basis`。
* `Q = Σ(mᵢ·Hᵢ)` 直接用原表的 LHV，**不做 HHV→LHV 换算**，也不乘燃烧效率、保护或规范系数。
* 面板「8 家具的热值」卡显示 `热值口径：低位热值（LHV，净热值）`；批量结果 Excel 多了 **`热值口径`** 一列。
* 若哪天数据表混入 HHV 或未注明口径的行，`mixed_heat_basis` 会变真，面板会提示「混合口径」、
  导出的 HTML/CSV 报告也会加注，此时结果**不能**当作统一净热值的规范设计值。
* 与参考方法一致：JRC《Handbook 5 – Design of buildings for the fire situation》用的也是
  材料质量 × **净热值**（net calorific value），再单列燃烧/保护系数与防火分区面积。

## 密度口径：两个「平均密度」不是一回事（0.5.3 起面板并列显示）

质量 / 体积约束里比的是**材料平均密度**，不是含空腔的体密度：

* 体密度（含空腔）= 质量 ÷ **包裹体积**（面板上的 `47.4 kg/m³` 这类数字）；
* 材料平均密度 = 质量 ÷ **（包裹体积 − 空腔）**，即 `体密度 ÷ (1 − 空腔占比)`（上例约 `141.8 kg/m³`）；
* 代码里不显式除，而是用比体积 `Σ(wᵢ/ρᵢ)`（每 kg 材料占多少 m³）算：
  `needed = 体密度 × Σ(wᵢ/ρᵢ)`，即「材料体积 ÷ 包裹体积」；`needed ≤ 1` 就等价于
  「材料平均密度 ≥ 体密度」，`1 − needed` 就是空腔占比（`composition.py:205-215`）。
  所以**约束本来就用的是去空腔后的体积**，只是没有把 `needed` 直接叫「除空腔后的体积占比」。
* 该约束是**可行性上界**而不是等式：空腔占比没有实测，所以只会惩罚 `needed > 1`
  （材料的体积比包裹体积还大，物理上不可能），不会强迫 `needed = 1`；
* 若体积口径选的是「材料占据体积」（`volumeKind = material_volume`），则约束切换成
  **等式检验**（在质量/体积不确定性内），此时不应再扣空腔。

## LLM 直接估计（重量 + 火灾荷载，0.5.0 起）

左侧「4 LLM 直接估计」提供开关：**额外用 LLM 直接从图片预测重量与火灾荷载**。

* **额外对照（默认）**：模型只给出自己的 estimate，主流程数值完全不变，右侧多一张「LLM 直接估计（未校准对照）」
  卡片，列出质量、体积、平均热值、火灾荷载、材质份额前几项，以及它与主流程结果的 **±% 偏差**。
* **作为物理量输入**：仅在「没有手工填质量/体积」时生效——用 LLM 给的 mass_kg / volume_m3 代替 Fireprediction，
  任务会跳过 Fireprediction 调用，结果里的物理量来源标记为 llm-estimate，并在提示里注明「未经实称或 Fireprediction 校验」。
  若你已手工填了质量与体积，该选项自动退回「额外对照」。
* **图像怎么发**：优先用当前判定模型；若它是纯文本模型，自动改走视觉通道（*-modlens 视觉桥）后再把原图一起发送，
  事件流里会写明实际使用的提供方/模型。带图请求失败时会自动退回纯文本估计并提示。
* **失败会自动重试**（0.5.1 起）：推理型模型可能把整个输出预算花在思考上、结果一个字也不返回，
  或返回的不是 JSON。插件会先降低推理强度（若模型支持）、再提高输出预算并加「不要思考过程、只输出 JSON」，
  最后退回纯文本估计；日志里会写明 `finish=…` / `推理 … 字` / `输出 … tokens` 便于判断原因。

* **不要把它当基准值**：这是模型的量级估计（prompt 已要求输出 JSON：质量、体积、材质份额、平均热值、火灾荷载、置信度、notes），
  没有密度/体积闭合约束，也没有实物校验；正式计算仍以主流程（Fireprediction + 材质分割 + 约束）为准。

## 批量模式（0.6.0 起：Excel 输入 → 逐件跑流水线 → Excel 输出）

面板顶部的页签可切到「批量分析」：给一个 **Excel 清单** + 一个 **图片文件夹**，工具会逐件跑完整流程（Fireprediction → 分割 → 判定 → 材质占比 → 热值 → 火灾荷载），最后导出一张结果表。

* **输入表格**：第一行是表头，前三列建议 `编号 / 家具类型 / 尺寸`。表头缺失时按位置识别；列名也可以是 `序号/id/类别/category/外观尺寸` 等常见写法。
* **尺寸写法**：`120×75×60 cm`、`120x75x60`、`120 75 60 cm` 都可以；带单位时按单位换算，默认单位在面板上选（cm/mm/m）。
* **图片命名**：图片放在同一个文件夹（可含子文件夹），文件名与编号对应：`001.jpg`、`001.png`、`001_沙发.jpg` 都行；匹配顺序是「完全同名 → 去前导零 → 前缀 → 包含」，多个候选取名字最短的。
* **输出**：`%LOCALAPPDATA%\dsh-furniture-fireload\batches\<batchId>\批量结果-<batchId>.xlsx`，22 列：编号 / 家具类型 / 尺寸 / 单位 / 图片文件 / 状态 / 区域识别（0.7.2 起：本机 YOLO 或视觉大模型）/ 质量体积来源（0.8.0 起；1.1.0 起默认显示「内置训练模型」）/ 质量(kg) / 包裹体积(m³) / 平均密度(kg/m³) / 材料平均密度(kg/m³) / 材料占比合计 / 主材质 / 材质组合 / 平均热值(MJ/kg) / 热值口径（0.6.2 起）/ 火灾荷载(MJ) / 火灾荷载区间(MJ) / 覆盖率 / 用时(s) / 备注。面板上可直接下载。
* **沿用单件设置**：判定模型、视觉复核、分割阈值、体积口径都取「单件分析」页当前的值（「材质区域识别」「质量体积来源」与两个模型可以在批量页单独选）。
* **材质区域识别**：批量页可选「本机 YOLO 分割」或「视觉大模型直接判定」。选后者时每件会经同一个 JSON 通道向宿主模型要一次分割结果（目标框 + 可见材质面积占比），耗时约多一次视觉请求/件；某件失败只让该件回退 YOLO，并在「区域识别」列与备注写明。
* **质量体积来源（0.8.0 起）**：可选「Fireprediction 预测」（1.1.0 起为插件内置模型，显示「内置训练模型」）或「视觉大模型直接估计」。选后者时每件经同一个 JSON 通道向视觉模型要一次质量与外壳包裹体积（替代 Fireprediction，约多一次视觉请求/件）；某件失败只让该件回退 Fireprediction，并在「质量体积来源」列与备注写明。用大模型估计时物理量标记为 estimated，热值等结果只作量级参考。
* **两个模型可以不同**：批量页的「材质判定模型」用于区域识别与材质组合判定，「质量体积估计模型」只用于质量/体积估计；两个都是**和单件页一样的单选下拉**（宿主模型 / 「0 自定义模型」里保存的模型），留空则用宿主默认（自动挑支持图片的通道）。也就是说「质量体积」和「材质」可以由不同的大模型分别负责。
* **接口也可以不同（0.8.1 起；0.9.3 起统一成单下拉）**：下拉里的「自定义模型」来自「单件分析 → 0 自定义模型」里保存的条目（名称 / API 地址 / 模型名 / 密钥），不再需要在批量页逐个填地址与密钥；两个位置可以各选不同的自定义模型（甚至不同供应商）。密钥只保存在本机设置里，**不会写进批量目录的 `request.json`**；外部 API 失败同样按件回退（分割回退 YOLO、估计回退 Fireprediction）并在备注写明原因。
* **模板**：`GET /api/furniture-fireload/batch/template`（面板上「下载模板」）会生成一份带 3 行示例的 `批量输入模板.xlsx`；上传 `.xlsx` 用 `/batch/upload`。
* **选文件不用手敲路径（0.6.1 起）**：Excel 与图片文件夹旁都有「浏览…」按钮，弹出目录选择器（可换盘符、上一级、点文件名选 .xlsx、进入文件夹后点「选择此文件夹」）。路径校验失败的提示会显示在「批量输入」卡片顶部，不再提示在卡片底部。
* **限制**：一次最多 2000 行；批量任务与单件任务互斥（同一时刻只跑一个）。开启大模型分割/估计后耗时明显变长（每件各多一次视觉请求）。

## 产物

每次运行写到 `%LOCALAPPDATA%\dsh-furniture-fireload\jobs\<jobId>\`：

* `overlay.png` — 分割叠加图
* `crop.png` — 目标区域裁剪
* `主要材料报告.html` / `主要材料统计.csv` / `composition.json` — 原工具报告（含分割证据、大类方案、具体候选、物理输入来源、比例、热量贡献、限制）
* `fireprediction.json` — Fireprediction 原始记录（含图片 SHA256 关联校验）
* `result.json` — 面板序列化结果

## 宿主机接口（`/api/furniture-fireload`）

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health` | 存活 + bridge 文件状态 |
| GET | `/state` | 设置、路径探测、任务列表、自检状态 |
| GET/POST | `/settings` | 读写设置 |
| GET | `/models` | 当前会话可用模型（提供方/模型） |
| POST | `/upload` | 上传图片（base64）到插件数据目录 |
| POST | `/jobs` | 启动任务（同一时刻只跑一个，新任务会中止旧任务） |
| GET | `/jobs` / `/job?id=` | 任务摘要 / 任务详情（事件流 + 结果 payload） |
| POST | `/cancel` | 取消任务（杀进程树） |
| GET | `/file?id=&name=` | 取产物（含 `name=input` 取原图） |
| GET/POST | `/selfcheck` | 环境自检（client bundle + Python + 依赖 + 内置材质模块） |
| POST | `/batch` | 启动批量任务（Excel + 图片文件夹） |
| GET | `/batch?id=` / `/batch/cancel` | 批量任务进度 / 取消 |
| GET | `/batch/file?id=&name=` | 下载批量结果 Excel |
| GET | `/batch/template` | 下载批量输入模板（`.xlsx`） |
| POST | `/batch/upload` | 上传批量输入 Excel |

## 开发与验证脚本（不随插件发布）

```powershell
node scripts/selftest.mjs --client          # ModuleLoader 契约 / 组件桩渲染
node scripts/selftest.mjs                   # 完整（含 Python 探测与 py_compile）
node scripts/render_client.mjs              # 用真实 React 做一次 SSR，验证面板能渲染
node scripts/test_host.mjs stub             # 在 node 里加载宿主半边、跑真实任务（stub 判定 + 手工质量/体积）
node scripts/test_host.mjs nophys           # 不给质量/体积，校验 materials_only 分支的界面文案
node scripts/test_host.mjs fireprediction   # 同上，但用内置 Fireprediction 引擎推理物理量 + DeepSeek 宿主通道
node scripts/test_host.mjs notoolb          # 强制禁用 Fireprediction（内置 + 外部），验证回退到视觉模型估计
python scripts/test_builtin_fireprediction.py   # 内置引擎 vs FirepredictionCLI.exe 逐项对比（需要 CLI 与示例图）
python scripts/convert_weight_model.py          # 重建 weight_fusion.npz（需要系统 python 的 sklearn/joblib）
node scripts/test_host.mjs estimate         # LLM 直接估计作为物理量输入（桩模型返回固定 estimate）
FFX_LLM_ESTIMATE=extra node scripts/test_host.mjs host   # LLM 估计只作对照
FFX_DECIDER=vision FFX_EXPECT_IMAGES=1 node scripts/test_host.mjs host   # 校验图像通道（会附带图片）
FFX_VISION_MODE=off node scripts/test_host.mjs host                      # 校验关闭图像通道时只发文本
node scripts/ui_smoke.mjs                   # jsdom + 真实 React：挂载面板、点「开始分析」、校验九节点
FFX_SEGMENT=llm node scripts/test_host.mjs segment   # 不用 YOLO：桩模型直接给目标框+材质面积占比
FFX_SEGMENT=llm node scripts/test_host.mjs batch     # 批量时逐件走视觉大模型分割
FFX_SEGMENT=llm FFX_SEGMENT_BAD=1 node scripts/test_host.mjs batch   # 视觉分割失败 → 逐件回退 YOLO
FFX_BATCH_ESTIMATE=llm node scripts/test_host.mjs batch   # 批量：每件用视觉模型估计质量/体积（桩模型返回 16.2 kg）
FFX_BATCH_ESTIMATE=llm FFX_ESTIMATE_BAD=1 node scripts/test_host.mjs batch   # 估计失败 → 逐件回退 Fireprediction
FFX_BATCH_API=1 FFX_SEGMENT=llm FFX_BATCH_ESTIMATE=llm node scripts/test_host.mjs batch   # 走「自定义 API」通道（本地 mock 的 OpenAI 兼容端点）
FFX_BATCH_API=1 FFX_SEGMENT=llm FFX_BATCH_ESTIMATE=llm FFX_ESTIMATE_BAD=1 FFX_SEGMENT_BAD=1 node scripts/test_host.mjs batch   # 外部 API 失败 → 逐件回退
node scripts/test_host.mjs batch           # 批量模式：生成模板与 3 张图、跑 3 件、下载并校验结果 Excel
FFX_TEMPLATE_ONLY=1 node scripts/test_host.mjs batch   # 只生成模板与夹具，不跑批量
scripts\test_host_llm.mjs .tmp\request-stub.json --answer first   # 桥接+决策往返
node scripts/bump_version.mjs 0.2.2         # 改版本号（package.json + /health）
```

`test_host.mjs` 若设置 `FFX_DUMP=<dir>` 会把 `/state`、`/models`、`/job` 的真实响应存成 JSON，
`ui_smoke.mjs` 直接拿这些文件当后端，因此两者串起来就是「真后端 + 真前端」的离线联调。
`FFX_PLUGIN_ROOT=<已安装 generation 路径>` 可让 test_host 验证**安装后的拷贝**而不是源码目录。

`lib/diag.js` 的自检报告写到 `%LOCALAPPDATA%\dsh-furniture-fireload\selfcheck.json`
（也可用 `DSH_FURNITURE_FIRELOAD_REPORT` 指定）。

## 已知边界

* 体积口径必须一致：Fireprediction 给的是**外壳包裹体积（含封闭空腔）**，不能直接与材料密度相乘当质量；材料占比用的是材料占据体积。
* 单件结果单位是 **MJ**；要换成 MJ/m² 需要防火分区面积（原工具同样要求）。
* 钢等不燃材料计质量与占比，但热值为 0；缺失物性不补 0，而是标记 `missing` 并计入警告。
* Windows 下 Python 3.12 venv 里**不要用后台线程阻塞读 stdin**：会死锁后续模块 import（本插件已改为同步读）。
