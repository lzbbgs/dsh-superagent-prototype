# 飞书任务工作区不再自动进入左侧列表

## 改了什么

`Sessions.ensure` 在 worker 会话还不存在时，不再调用 `workspaceRegistry.create`。它改为 `sessionController.create({ sessionId, cwd, agentPreset })`。`cwd` 仍是该工单的执行目录。编排会话仍登记自己的工作区。

宿主 `session.create` 接受 `workspaceId` 或 `cwd`，不能同时给。只有带 `workspaceId` 的创建才会 `attachSession`。不带 `workspaceId` 的会话不成为左侧工作区分组，目录和会话都还在。这是 0.2.1-alpha.2 的 `SessionCreateRequest` 和桌面 0.2.2-rc.1 的 `SessionCommandController.create` 都有的行为。

归档不能用来隐藏这些会话。`archived-session-gate` 会拒绝已归档会话的 `agent/pre-step`，worker 就无法继续跑。宿主也没有“工作区隐藏但仍运行”的标志。空的工作区分组在普通视图里照样显示，所以只归档会话也留不下标题行。

## 已经出现在列表里的条目

这个补丁不改已有登记，不删目录，不合并会话。

要自己从列表去掉某一条：在该工作区行上打开菜单，选删除工作区。0.2.2 的确认文案是：将把该名称从工作区列表中移除；文件夹与会话记录会保留；其会话将显示在“未分组”下。对应的宿主实现是 `workspaceRegistry.delete`，只删除登记。

删掉之后，那条会话出现在“未分组”，仍然可以按会话 id 继续跑。把同一文件夹再添加为工作区，会新建一条空的登记；公开的 workspace API 没有把已有会话重新挂回去的操作。所以这一步是从列表移除，不是临时隐藏。不需要的话就不要点。

## 部署

在已安装的扩展源码上应用 `artifacts/worker-sidebar.patch`（只改 `src/app/sessions.ts` 的 worker 创建参数；本地的 ComfyUI、提示词和 Windows 改动不在这个补丁里）。然后在该目录执行构建，用构建结果替换正在加载的扩展产物，再重启 DeepSeek Harness。重启会结束正在跑的指派并按原恢复说明重新开始，不删除工单目录或会话日志。

新接受的工单不再往左侧工作区列表加一行。已有的那些行保持不动，直到按上面的菜单逐条移除。

## 回滚

换回替换前的扩展产物并重启。已经用菜单移除的登记不会因为回滚自动出现；目录和会话日志都还在。不要改 `orchestrator.sqlite` 或宿主的工作区库。

## 测试

`pnpm exec vitest run tests/followup-workspace.spec.ts tests/followups.spec.ts`：20 passed。`pnpm exec tsc --noEmit` 通过。worker 创建请求只有 `cwd`，没有 `workspaceId`；同一线程的后续消息不新增工单、目录或会话 id。
