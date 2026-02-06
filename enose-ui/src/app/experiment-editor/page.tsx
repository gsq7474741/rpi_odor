// @deprecated 此页面已迁移到 /workflow，请使用新路由
// 保留此文件用于向后兼容，访问 /experiment-editor 会自动重定向到 /workflow
// 原始代码已移至 /workflow/page.tsx
import { redirect } from "next/navigation";

export default function ExperimentEditorPageDeprecated() {
  redirect("/workflow");
}
