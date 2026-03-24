"""ML 分类器模块 — StandardScaler + 多分类器 CV Pipeline。

输入: features dict + 标签数组
输出: 排序后的 (特征, 分类器, 准确率) 结果表
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass, field

from .features import FeatureSet
from .utils import log, StepTimer, progress_bar


@dataclass
class ClassificationResult:
    """单个 (特征, 分类器) 组合的结果"""
    feature_name: str
    classifier_name: str
    accuracy: float
    std: float
    fold_scores: np.ndarray
    error: str | None = None


@dataclass
class TaskResult:
    """一个分类任务的完整结果"""
    task_name: str
    n_samples: int
    n_classes: int
    n_folds: int
    results: list[ClassificationResult] = field(default_factory=list)

    @property
    def random_baseline(self) -> float:
        return 1.0 / self.n_classes if self.n_classes > 0 else 0.0

    def sorted_results(self) -> list[ClassificationResult]:
        """按准确率降序排列"""
        return sorted(self.results, key=lambda r: -r.accuracy)

    def print_top(self, top_k: int = 10):
        """打印 Top-K 结果"""
        sorted_r = self.sorted_results()
        n_show = min(top_k, len(sorted_r))
        baseline = self.random_baseline

        print(f"\n  {self.task_name} Top-{n_show} "
              f"({self.n_samples}样本, {self.n_classes}类, "
              f"{self.n_folds}-fold CV, 随机基线={baseline:.1%}):")
        print(f"  {'Rank':<5} {'Feature':<20} {'Classifier':<15} {'Acc':>8} {'Std':>8}  Folds")
        print(f"  {'-'*75}")

        for rank, r in enumerate(sorted_r[:n_show], 1):
            folds = ", ".join(f"{s:.0%}" for s in r.fold_scores) if len(r.fold_scores) > 0 else "N/A"
            print(f"  {rank:<5} {r.feature_name:<20} {r.classifier_name:<15} "
                  f"{r.accuracy:>7.1%} ±{r.std:>5.1%}  [{folds}]")

        if sorted_r:
            best = sorted_r[0]
            print(f"\n  >>> 最佳: {best.accuracy:.1%} ({best.feature_name} + {best.classifier_name})")


def _build_classifiers(seed: int = 42) -> dict:
    """构建分类器字典"""
    from sklearn.linear_model import LogisticRegression
    from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
    from sklearn.neighbors import KNeighborsClassifier
    from sklearn.svm import SVC
    from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier

    return {
        "LR": LogisticRegression(max_iter=5000, random_state=seed, C=1.0, solver="lbfgs"),
        "LDA": LinearDiscriminantAnalysis(),
        "KNN-3": KNeighborsClassifier(n_neighbors=3),
        "KNN-5": KNeighborsClassifier(n_neighbors=5),
        "SVM-lin": SVC(kernel="linear", C=1.0, random_state=seed),
        "SVM-rbf": SVC(kernel="rbf", C=10.0, gamma="scale", random_state=seed),
        "RF-100": RandomForestClassifier(n_estimators=100, random_state=seed, n_jobs=-1),
        "RF-300": RandomForestClassifier(n_estimators=300, max_depth=10, random_state=seed, n_jobs=-1),
        "GBM": GradientBoostingClassifier(n_estimators=100, max_depth=3, random_state=seed),
    }


def run_classification(
    features: dict[str, FeatureSet],
    y: np.ndarray,
    task_name: str,
    seed: int = 42,
    max_folds: int = 5,
) -> TaskResult:
    """对给定特征集和标签运行多分类器交叉验证。

    Args:
        features: 特征字典
        y: 标签数组 (整数编码)
        task_name: 任务名称
        seed: 随机种子
        max_folds: 最大折数

    Returns:
        TaskResult 包含所有 (特征, 分类器) 组合的结果
    """
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import StratifiedKFold, cross_val_score
    from sklearn.pipeline import Pipeline

    unique_classes = np.unique(y)
    n_classes = len(unique_classes)
    min_class_count = min(np.sum(y == c) for c in unique_classes)
    n_folds = min(max_folds, min_class_count)

    task = TaskResult(
        task_name=task_name,
        n_samples=len(y),
        n_classes=n_classes,
        n_folds=n_folds,
    )

    if n_folds < 2:
        log.warning(f"  {task_name}: 最小类样本数={min_class_count}，无法做 CV")
        return task

    classifiers = _build_classifiers(seed)
    skf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=seed)

    total = len(features) * len(classifiers)
    pbar = progress_bar(range(total), desc=f"{task_name}")
    idx = 0

    for feat_name, feat_set in features.items():
        X = feat_set.X
        for clf_name, clf in classifiers.items():
            pipe = Pipeline([("scaler", StandardScaler()), ("clf", clf)])
            try:
                scores = cross_val_score(pipe, X, y, cv=skf, scoring="accuracy")
                task.results.append(ClassificationResult(
                    feature_name=feat_name,
                    classifier_name=clf_name,
                    accuracy=scores.mean(),
                    std=scores.std(),
                    fold_scores=scores,
                ))
            except Exception as e:
                task.results.append(ClassificationResult(
                    feature_name=feat_name,
                    classifier_name=clf_name,
                    accuracy=0.0, std=0.0,
                    fold_scores=np.array([]),
                    error=str(e),
                ))
            idx += 1
            pbar.update(1)

    pbar.close()
    return task
