后续结论已改为可见性修复，见 `artifacts/worker-sidebar.md` 和 `artifacts/worker-sidebar.patch`。

同一线程的后续消息本来就不会新建工单目录。左侧多出来的是工作区登记。worker 不再调用 `workspaceRegistry.create`。已经出现的行不会被这个补丁删除。
