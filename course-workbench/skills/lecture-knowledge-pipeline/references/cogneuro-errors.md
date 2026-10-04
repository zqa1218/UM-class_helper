# 认知神经学高频易错点

两个用途：校对转写稿时优先检查这些位置；出题时作为干扰项素材。

## 一、ASR 最容易听错的术语

转写稿里出现下列词的疑似变体时逐条核对。

**缩写与方法**

BOLD、fMRI、EEG、ERP、MEG、PET、NIRS、tDCS、TMS、DTI、MNI、Talairach、GLM、HRF、TR、TE、voxel、ROI、FWE、FDR、cluster、Bonferroni、ICA、PCA、MVPA、RSA、decode

**ERP 成分**（名称与时间窗都容易错）

P1、N1、P2、N2、P3/P300、N400、P600、MMN、ERN、Pe、LPP、CNV

极性与时间窗配对错误是最高频的转写错误。

**解剖与脑区**

Broca 与 Wernicke（最常被互换）、DLPFC、vmPFC、OFC、dACC/rACC、脑岛（AI）、amygdala、hippocampus、striatum、TPJ、STS、FFA、PPA、MT/V5，以及 BA 分区号（BA44/45 与 BA22 不要混）。

**统计与实验设计**

被试间与被试内、混淆变量、双盲、基线、counterbalance、p 值与效应量、置信区间、统计效力。

## 二、语义层面的常见错误

这些错误转写看不出问题，但内容本身要拦下来：

1. **相关当因果** — 「某脑区激活导致……」应为「与……相关」
2. **分辨率张冠李戴** — fMRI 空间分辨率好、时间分辨率差；EEG/MEG 反之
3. **成分功能简化** — 把 N400 只等于语义违反、P600 只等于句法违反，忽略二者重叠的证据
4. **脑区功能绝对化** — 「Broca 区就是语言产生中枢」，应为「参与语言产生」
5. **BOLD 等同神经活动** — BOLD 是间接的血氧代谢指标，不等于神经元放电
6. **减法解释过度** — 任务对比的差值不等于「纯粹」的认知过程
7. **逆向推断** — 从激活位置反推心理过程，忽略多对多映射
8. **样本外推** — 小样本结论说成普遍规律

## 三、可直接用作干扰项的对比组

| 正确配对 | 常见错误配对 |
|---|---|
| N400 ↔ 语义加工 | N400 ↔ 句法加工 |
| P600 ↔ 句法再分析 | P600 ↔ 语义 N400 型效应 |
| Broca 区 ↔ 语言产生/句法 | Broca 区 ↔ 语言理解 |
| Wernicke 区 ↔ 语言理解 | Wernicke 区 ↔ 语言产生 |
| MMN ↔ 听觉偏差自动检测 | MMN ↔ 注意资源分配 |
| ERN ↔ 错误监测 | ERN ↔ 刺激评估（属 N200 家族） |
| P300 ↔ 注意与工作记忆更新 | P300 ↔ 纯感觉编码 |
| 海马 ↔ 情景记忆巩固 | 海马 ↔ 程序性运动学习 |
| 杏仁核 ↔ 情绪显著性 | 杏仁核 ↔ 工作记忆维持 |
| DLPFC ↔ 工作记忆与执行控制 | DLPFC ↔ 初级感觉加工 |
| fMRI ↔ 高空间分辨率 | fMRI ↔ 高时间分辨率 |
| EEG/MEG ↔ 高时间分辨率 | EEG ↔ 高空间分辨率 |

## 四、中英混说的固定译法

课堂常中英混说，转写容易出现半截词。整理时保留英文原词，首次出现给中文，之后按老师习惯。

- 冲突代价 conflict cost；冲突监测 conflict monitoring
- 启动效应 priming；掩蔽启动 masked priming
- 适应 adaptation；重复抑制 repetition suppression
- 血氧水平依赖 BOLD；血流动力学响应函数 HRF
- 被试间 between-subject；被试内 within-subject
- 效应量 effect size；统计效力 power

## 五、学科不是认知神经学时

按同样结构先整理一份本学科清单再出题：缩写与方法、专有名词、易混配对、常见因果误述、中英对照。把结果写进 `04_corrections/domain-errors.md`，后续复用于纠错与出题。
