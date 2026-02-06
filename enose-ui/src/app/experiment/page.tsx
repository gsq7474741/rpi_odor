// @deprecated 此页面已迁移到 /run，请使用新路由
// 保留此文件用于向后兼容，访问 /experiment 会自动重定向到 /run
// 原始代码已移至 /run/page.tsx
import { redirect } from "next/navigation";

export default function ExperimentPageDeprecated() {
  redirect("/run");
}
