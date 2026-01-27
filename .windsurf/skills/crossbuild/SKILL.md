---
name: crossbuild
description: 交叉编译 C++ 后端并部署到树莓派
---

# 交叉编译部署技能

用于将 enose-control C++ 后端交叉编译并部署到树莓派。

## 使用场景

当修改了以下文件后需要部署：
- `enose-control/src/**/*.cpp`
- `enose-control/src/**/*.hpp`
- `enose-control/proto/**/*.proto`

## 执行步骤

1. 运行部署脚本：

```powershell
.\scripts\deploy_crossbuild_enose_control.ps1
```

工作目录：`d:\WindSurfProjects\rpi_odor`

2. 脚本会自动：
   - 交叉编译 C++ 代码
   - 通过 SSH 上传到树莓派
   - 重启 enose-control 服务
   - 复制生成的 TypeScript 类型到前端

## 远程环境

- 主机：`rpi5.local`
- 用户：`user`
- 密码：`123456`
- 服务：`enose-control.service`

## 验证部署

检查服务状态：

```bash
ssh user@rpi5.local "sudo systemctl status enose-control"
```

查看日志：

```bash
ssh user@rpi5.local "sudo journalctl -u enose-control -f"
```
